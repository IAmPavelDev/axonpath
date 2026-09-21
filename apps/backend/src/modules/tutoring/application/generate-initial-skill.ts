import { EventType, SkillStatus, VectorSource } from "@/prisma/generated";
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
import {
  extractJsonObject,
  toGeneratedQuestion,
  type GeneratedQuestion,
} from "@/modules/tutoring/domain/parse";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { NewVector, VectorStoreError } from "@/modules/memory/ports";

export type ParsedInitSkill = {
  classTitle: string;
  classContentMd: string;
  lessonSummary: string;
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

/**
 * The AI initialization pipeline for a freshly created GENERATING skill. Runs
 * in the background ("skill-init" job):
 *   1. Generate + persist the skill description.
 *   2. Retrieve the user's prior context (embed topic, semantic search) to
 *      personalize generation.
 *   3. Generate the initial class + quiz + lesson summary + context snippets.
 *   4. Audit SKILL_CREATED.
 *   5. Persist class, questions, and vectors (lessonSummary as AI_NEXT — the
 *      per-lesson memory unit — snippets as AI_INITIAL).
 *
 * Degradation rules: description failure -> skip description; retrieval
 * failure -> no personalization; generation/parse failure -> err. Status
 * lifecycle: success flips the skill ACTIVE; any failure flips it FAILED and
 * records ERROR_OCCURRED (the job handler logs the error itself).
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
  }: GenerateInitialSkillDeps) => {
    const attempt = async (
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

      // 3. Generate the initial class + quiz + summary + snippets.
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
        // Named cast: untrusted model output; every field re-validated below.
        const raw = extractJsonObject(generation.value.raw) as Partial<ParsedInitSkill>;
        parsed = {
          classTitle: raw.classTitle ?? "Unknown title",
          classContentMd: raw.classContentMd ?? "",
          lessonSummary: raw.lessonSummary ?? "",
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

      // Lesson summary (AI_NEXT — the per-lesson memory unit) and the
      // learner-facing snippets (AI_INITIAL) share one embedding call.
      const vectorInputs: { text: string; source: VectorSource }[] = [];
      if (parsed.lessonSummary.trim().length > 0) {
        vectorInputs.push({ text: parsed.lessonSummary, source: VectorSource.AI_NEXT });
      }
      for (const snippet of parsed.contextSnippets) {
        vectorInputs.push({ text: snippet, source: VectorSource.AI_INITIAL });
      }

      if (vectorInputs.length > 0) {
        const embeddings = await ai.generateEmbeddings(
          vectorInputs.map((vector) => vector.text),
        );
        if (!embeddings.ok) {
          return { ok: false, error: embeddings.error };
        }
        const vectors: NewVector[] = embeddings.value.map((embedding, i) => ({
          skillId: input.skillId,
          userId: input.userId,
          classId: createdClass.id,
          embedding,
          source: vectorInputs[i].source,
          textSnippet: vectorInputs[i].text,
          classIndex: 0,
        }));
        await recordVectors(vectors);
      }

      return { ok: true, value: undefined };
    };

    return async (
      input: GenerateInitialSkillInput,
    ): Promise<Result<void, GenerateInitialSkillError>> => {
      const result = await attempt(input);
      if (result.ok) {
        await skillRepo.update(input.skillId, { status: SkillStatus.ACTIVE });
      } else {
        await skillRepo.update(input.skillId, { status: SkillStatus.FAILED });
        await eventRepo.record({
          skillId: input.skillId,
          userId: input.userId,
          type: EventType.ERROR_OCCURRED,
          payload: { action: "init_skill", error: result.error },
        });
      }
      return result;
    };
  };
