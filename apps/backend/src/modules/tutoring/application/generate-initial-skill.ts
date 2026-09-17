import { EventType, QuestionType, VectorSource } from "@/prisma/generated";
import type { Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import {
  buildInitSkillPrompt,
  buildSkillDescriptionPrompt,
  INIT_SKILL_SCHEMA,
  SKILL_DESCRIPTION_SCHEMA,
} from "@/modules/tutoring/domain/prompts";
import {
  DESCRIPTION_SYSTEM,
  TUTOR_SYSTEM,
} from "@/modules/tutoring/domain/personas";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { NewVector, VectorStoreError } from "@/modules/memory/ports";

export type GeneratedQuestion = {
  type: QuestionType;
  text: string;
  choices: string[];
  answerKey: string;
};

export type ParsedInitSkill = {
  classTitle: string;
  classContentMd: string;
  questions: GeneratedQuestion[];
  contextSnippets: string[];
};

export type GenerateInitialSkillError =
  | { kind: "AiGenerationFailed"; detail?: string }
  | { kind: "AiResponseInvalid"; detail?: string }
  | { kind: "VectorUpsertFailed"; detail?: string }
  | { kind: "VectorStoreUnavailable"; detail?: string };

export type GenerateInitialSkillDeps = {
  ai: AiPort;
  retrieveContext: (input: {
    userId: number;
    query: string;
    excludeSkillId: number;
  }) => Promise<{ textSnippet: string }[]>;
  skillRepo: SkillRepository;
  classRepo: ClassRepository;
  quizRepo: QuizRepository;
  eventRepo: EventRepository;
  recordVectors: (vectors: NewVector[]) => Promise<Result<number[], VectorStoreError>>;
  chatModel: string;
};

export type GenerateInitialSkillInput = {
  skillId: number;
  userId: number;
  topic: string;
};


/** The bound, dependency-complete use case — what the job registry consumes. */
export type GenerateInitialSkill = (
  input: GenerateInitialSkillInput,
) => Promise<Result<void, GenerateInitialSkillError>>;
/** Strip markdown fences / surrounding prose, then parse. */
const extractJsonObject = (raw: string): unknown => {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate);
};

/**
 * glm-5.3-flash drifts from the JSON schema (renames fields, invents extra
 * keys, skips required ones). Coerce each returned question to
 * GeneratedQuestion; drop anything that does not fit instead of failing the
 * whole quiz insert.
 */
const toGeneratedQuestion = (value: unknown): GeneratedQuestion | null => {
  if (typeof value !== "object" || value === null) return null;
  const q = value as Record<string, unknown>;
  if (q.type !== "MULTIPLE_CHOICE" && q.type !== "TRUE_FALSE") return null;
  // The model tends to emit `question` for the schema's `text` field.
  const text = q.text ?? q.question;
  if (typeof text !== "string" || text.length === 0) return null;
  const rawChoices = Array.isArray(q.choices) ? q.choices : [];
  const choices: string[] = [];
  for (const choice of rawChoices) {
    if (typeof choice !== "string") return null;
    choices.push(choice);
  }
  if (choices.length === 0) return null;
  if (typeof q.answerKey !== "string" || q.answerKey.length === 0) return null;
  return { type: q.type, text, choices, answerKey: q.answerKey };
};

/**
 * The AI initialization pipeline for a freshly created DRAFT skill. Runs in
 * the background ("skill-init" job):
 *   1. Generate + persist the skill description.
 *   2. Retrieve the user's prior context (embed topic, semantic search) to
 *      personalize generation.
 *   3. Generate the initial class + quiz + context snippets.
 *   4. Audit SKILL_CREATED.
 *   5. Persist class, questions, and AI_INITIAL vectors.
 *
 * Behavior mirrors the old controller-level runDetached block 1:1, including
 * degradation rules: description failure -> skip description; retrieval
 * failure -> no personalization; generation/parse failure -> err (job logs,
 * skill stays DRAFT).
 */
export const makeGenerateInitialSkill =
  ({
    ai,
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    eventRepo,
    recordVectors,
    chatModel,
  }: GenerateInitialSkillDeps) =>
  async (
    input: GenerateInitialSkillInput,
  ): Promise<Result<void, GenerateInitialSkillError>> => {
    // 1. Description (best-effort: failure yields "" and still updates).
    const descriptionResult = await ai.generateJson(
      {
        system: DESCRIPTION_SYSTEM,
        prompt: buildSkillDescriptionPrompt(input.topic),
      },
      { schemaName: "skill_description", responseSchema: SKILL_DESCRIPTION_SCHEMA },
    );

    let description = "";
    if (descriptionResult.ok) {
      try {
        const parsed: unknown = extractJsonObject(descriptionResult.value.raw);
        if (typeof parsed === "string") {
          description = parsed.trim();
        } else if (
          typeof parsed === "object" &&
          parsed !== null &&
          "description" in parsed
        ) {
          const d = parsed.description;
          if (typeof d === "string") description = d.trim();
        }
      } catch {
        // glm-5.3-flash sometimes answers prose despite the JSON schema;
        // the prose itself is the description.
        description = descriptionResult.value.raw.trim();
      }
    }
    await skillRepo.update(input.skillId, { description });

    // 2. Personalization context (best-effort: failure -> no context).
    const priorContext = (
      await retrieveContext({
        userId: input.userId,
        query: input.topic,
        excludeSkillId: input.skillId,
      })
    ).map((hit) => hit.textSnippet);

    // 3. Generate the initial class + quiz + snippets.
    const prompt = buildInitSkillPrompt({
      topic: input.topic,
      priorContext,
    });

    const generation = await ai.generateJson(
      { system: TUTOR_SYSTEM, prompt },
      { schemaName: "init_skill", responseSchema: INIT_SKILL_SCHEMA },
    );

    if (!generation.ok) {
      return { ok: false, error: generation.error };
    }
    let parsed: ParsedInitSkill;
    try {
      const raw = extractJsonObject(generation.value.raw) as Partial<ParsedInitSkill>;
      parsed = {
        classTitle: raw.classTitle ?? "Unknown title",
        classContentMd: raw.classContentMd ?? "",
        questions: (Array.isArray(raw.questions) ? raw.questions : [])
          .map(toGeneratedQuestion)
          .filter((q): q is GeneratedQuestion => q !== null),
        contextSnippets: raw.contextSnippets ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: "AiResponseInvalid",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }

    // 4. Audit SKILL_CREATED with the full request + response for debugging.
    await eventRepo.record({
      skillId: input.skillId,
      userId: input.userId,
      type: EventType.SKILL_CREATED,
      payload: {
        action: "init_skill",
        prompt,
        system: TUTOR_SYSTEM,
        model: chatModel,
        response: generation.value.raw,
      },
    });

    // 5. Persist class, questions, vectors.
    const createdClass = await classRepo.create({
      skillId: input.skillId,
      index: 0,
      title: parsed.classTitle,
      contentMd: parsed.classContentMd,
      aiModel: chatModel,
    });

    await quizRepo.createQuestions(
      parsed.questions.map((question) => ({
        skillId: input.skillId,
        classId: createdClass.id,
        type: question.type,
        text: question.text,
        choices: question.choices,
        answerKey: question.answerKey,
        aiModel: chatModel,
      })),
    );

    if (parsed.contextSnippets.length > 0) {
      const embeddings = await ai.generateEmbeddings(parsed.contextSnippets);
      if (!embeddings.ok) {
        return { ok: false, error: embeddings.error };
      }
      const vectors: NewVector[] = embeddings.value.map((embedding, i) => ({
          skillId: input.skillId,
          userId: input.userId,
          classId: createdClass.id,
          embedding,
          source: VectorSource.AI_INITIAL,
          textSnippet: parsed.contextSnippets[i],
          classIndex: 0,
        }));
        await recordVectors(vectors);
    }

    return { ok: true, value: undefined };
  };
