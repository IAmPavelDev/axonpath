import { EventType, QuestionType, VectorSource } from "@/prisma/generated";
import type { Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import {
  buildInitSkillPrompt,
  buildSkillDescriptionPrompt,
  INIT_SKILL_SCHEMA,
  SKILL_DESCRIPTION_SCHEMA,
} from "@/modules/tutoring/domain/prompts";
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
      buildSkillDescriptionPrompt(input.topic),
      { schemaName: "skill_description", responseSchema: SKILL_DESCRIPTION_SCHEMA },
    );

    let description = "";
    if (descriptionResult.ok) {
      try {
        const parsed = extractJsonObject(descriptionResult.value.raw) as {
          description?: string;
        };
        description = parsed.description ?? "";
      } catch {
        description = "";
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

    const generation = await ai.generateJson(prompt, {
      schemaName: "init_skill",
      responseSchema: INIT_SKILL_SCHEMA,
    });

    if (!generation.ok) {
      return { ok: false, error: generation.error };
    }
    let parsed: ParsedInitSkill;
    try {
      const raw = extractJsonObject(generation.value.raw) as Partial<ParsedInitSkill>;
      parsed = {
        classTitle: raw.classTitle ?? "Unknown title",
        classContentMd: raw.classContentMd ?? "",
        questions: raw.questions ?? [],
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

    // 4. Audit SKILL_CREATED (same payload shape as before).
    await eventRepo.record({
      skillId: input.skillId,
      userId: input.userId,
      type: EventType.SKILL_CREATED,
      payload: {
        action: "init_skill",
        prompt: prompt.substring(0, 2000),
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
