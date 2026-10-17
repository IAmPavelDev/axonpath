import {
  generationFailed,
  generationSkipped,
  generationStarted,
  generationSucceeded,
} from "@/lib/generation-logger";

import { EventType, SkillStatus, VectorSource } from "@/prisma/generated";
import type { Result } from "@/modules/platform/result";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { CLASS_CONTENT_VECTORS_JOB } from "@/modules/memory/application/vectorize-class-content";
import type { AiPort } from "@/modules/tutoring/ports";
import {
  buildInitSkillPrompt,
  INIT_SKILL_SCHEMA,
} from "@/modules/tutoring/domain/prompts";
import { validateLessonLanguages } from "@/modules/tutoring/domain/lesson-langs";
import { TUTOR_SYSTEM } from "@/modules/tutoring/domain/personas";
import { embeddingTokenCounts } from "@/modules/tutoring/domain/embedding-tokens";
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
import {
  outcomeForError,
  type RecordAiAttempt,
} from "@/modules/tutoring/infrastructure/ai-attempt.repo";

export const SKILL_FIRST_LESSON_JOB = "skill-first-lesson";

export type SkillFirstLessonJobPayload = {
  skillId: number;
  userId: number;
};

export type ParsedFirstLesson = {
  classTitle: string;
  classContentMd: string;
  baseLanguage: string;
  contentLanguages: string[];
  lessonSummary: string;
  questions: GeneratedQuestion[];
  contextSnippets: string[];
};

export type GenerateFirstLessonError =
  | { kind: "AiGenerationFailed"; detail?: string }
  | { kind: "AiResponseInvalid"; detail?: string };

export type GenerateFirstLessonDeps = {
  ai: AiPort;
  recordAiAttempt: RecordAiAttempt;
  retrieveContext: (input: {
    userId: number;
    query: string;
    excludeSkillId: number;
  }) => Promise<{ textSnippet: string }[]>;
  skillRepo: SkillRepository;
  classRepo: ClassRepository;
  quizRepo: QuizRepository;
  eventRepo: EventRepository;
  recordVectors: (
    vectors: NewVector[],
  ) => Promise<Result<number[], VectorStoreError>>;
  chatModel: string;
  /** Fire-and-forget queue: class-content vectorization rides it after the commit. */
  jobs: JobQueuePort;
};

export type GenerateFirstLessonInput = SkillFirstLessonJobPayload;

/** The bound, dependency-complete use case — what the job registry consumes. */
export type GenerateFirstLesson = (
  input: GenerateFirstLessonInput,
) => Promise<Result<void, GenerateFirstLessonError>>;

/**
 * Stage 2 of the create-with-prompt flow (the "skill-first-lesson" job,
 * armed by skill.edit when the user accepts the generated title/description
 * — an ACTIVE skill with zero classes). Composes lesson 0 from the stored
 * prompt (+ description) and the learner's prior-skill memory:
 *   1. Retrieve the user's prior context (embed the brief, semantic search).
 *   2. Generate the initial class + quiz + lesson summary + context snippets.
 *   3. Audit CLASS_GENERATED.
 *   4. Persist class, questions, and vectors (lessonSummary as AI_NEXT — the
 *      per-lesson memory unit — snippets as AI_INITIAL).
 *
 * Degradation rules: retrieval failure -> no personalization;
 * generation/parse failure -> err. Status lifecycle: success settles the
 * skill ACTIVE; any failure settles FAILED and records ERROR_OCCURRED (the
 * job handler logs the error itself). A lost job is re-armed by the
 * skill-init sweeper, so the pipeline is safe to replay: an existing class
 * short-circuits generation and merely heals the status.
 */
export const makeGenerateFirstLesson =
  ({
    recordAiAttempt,
    ai,
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    eventRepo,
    recordVectors,
    chatModel,
    jobs,
  }: GenerateFirstLessonDeps): GenerateFirstLesson =>
  async (input) => {
    const skill = await skillRepo.findById(input.skillId);
    // The skill row is deleted only with its owner (cascade); a missing row
    // means a replay after deletion — nothing to generate for.
    if (!skill) {
      return { ok: true, value: undefined };
    }
    const logCtx = {
      pipeline: "skill_first_lesson",
      skillId: input.skillId,
      skillName: skill.topic.slice(0, 120),
      userId: input.userId,
    } as const;
    generationStarted(logCtx);
    const startedAt = Date.now();

    // Replay guard: a previous attempt may have persisted the class before
    // failing. Regenerating would violate UNIQUE(skillId, index) — settle
    // the status and stop.
    const existing = await classRepo.findTopBySkill(input.skillId);
    if (existing !== null) {
      await skillRepo.update(input.skillId, { status: SkillStatus.ACTIVE });
      generationSkipped(logCtx, {
        durationMs: Date.now() - startedAt,
        reason: "lesson 0 already exists",
      });
      return { ok: true, value: undefined };
    }

    // 1. Personalization context (best-effort: failure -> no context). The
    //    learner's original brief is richer than the generated title.
    const brief = skill.prompt.length > 0 ? skill.prompt : skill.topic;
    const priorContext = (
      await retrieveContext({
        userId: input.userId,
        query: brief,
        excludeSkillId: input.skillId,
      })
    ).map((hit) => hit.textSnippet);

    // 2. Generate the initial class + quiz + summary + snippets. The
    //    description (possibly user-edited at acceptance) carries the goal.
    const goal =
      skill.description.length > 0
        ? `Axon drafted this description of the skill (the learner may have edited it):\n"""${skill.description}"""\n`
        : "";
    const prompt = `${buildInitSkillPrompt({
      topic: brief,
      priorContext,
    })}${goal}`;
    const generationStartedAt = Date.now();
    const generation = await ai.generateJson(
      { system: TUTOR_SYSTEM, prompt },
      { schemaName: "init_skill", responseSchema: INIT_SKILL_SCHEMA },
    );

    if (!generation.ok) {
      recordAiAttempt({
        userId: input.userId,
        operation: "init_skill",
        ...outcomeForError(generation.error),
        latencyMs: Date.now() - generationStartedAt,
      });
      return await fail(generation.error);
    }
    let parsed: ParsedFirstLesson;
    try {
      // Named cast: untrusted model output; every field re-validated below.
      const raw = extractJsonObject(
        generation.value.raw,
      ) as Partial<ParsedFirstLesson>;
      parsed = {
        classTitle: raw.classTitle ?? "Unknown title",
        classContentMd: raw.classContentMd ?? "",
        baseLanguage: raw.baseLanguage ?? "",
        contentLanguages: Array.isArray(raw.contentLanguages)
          ? raw.contentLanguages.filter((l): l is string => typeof l === "string")
          : [],
        lessonSummary: raw.lessonSummary ?? "",
        questions: (Array.isArray(raw.questions) ? raw.questions : [])
          .map(toGeneratedQuestion)
          .filter((q): q is GeneratedQuestion => q !== null),
        contextSnippets: raw.contextSnippets ?? [],
      };
      const langViolation = validateLessonLanguages(
        parsed.classContentMd,
        parsed.baseLanguage,
        parsed.contentLanguages,
      );
      if (langViolation) throw new Error(langViolation);
    } catch (error) {
      recordAiAttempt({
        userId: input.userId,
        operation: "init_skill",
        outcome: "parse_failed",
        latencyMs: Date.now() - generationStartedAt,
        rawChars: generation.value.raw.length,
        errorKind: error instanceof Error ? error.message : String(error),
      });
      return await fail({
        kind: "AiResponseInvalid",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    // A lesson without questions is a dead end — retry-skill is the only
    // way forward. Fail the generation instead of persisting a hollow
    // class (the skill settles FAILED; the client offers a retry).
    if (parsed.questions.length === 0) {
      recordAiAttempt({
        userId: input.userId,
        operation: "init_skill",
        outcome: "empty",
        latencyMs: Date.now() - generationStartedAt,
        rawChars: generation.value.raw.length,
        errorKind: "model returned no questions",
      });
      return await fail({
        kind: "AiResponseInvalid",
        detail: "model returned no questions",
      });
    }

    recordAiAttempt({
      userId: input.userId,
      operation: "init_skill",
      outcome: "ok",
      latencyMs: Date.now() - generationStartedAt,
      promptTokens: generation.value.usage?.promptTokens,
      completionTokens: generation.value.usage?.completionTokens,
      rawChars: generation.value.raw.length,
    });

    // 3. Audit CLASS_GENERATED with the full request + response for
    //    debugging; the usage report reads the nextClass bucket from it.
    await eventRepo.record({
      skillId: input.skillId,
      userId: input.userId,
      type: EventType.CLASS_GENERATED,
      payload: {
        action: "first_lesson",
        prompt,
        system: TUTOR_SYSTEM,
        model: chatModel,
        usage: generation.value.usage,
        response: generation.value.raw,
      },
    });
    const createdClass = await classRepo.createWithQuestions(
      {
        skillId: input.skillId,
        index: 0,
        title: parsed.classTitle,
        contentMd: parsed.classContentMd,
        baseLanguage: parsed.baseLanguage,
        aiModel: chatModel,
      },
      parsed.questions.map((question) => ({
        type: question.type,
        text: question.text,
        choices: question.choices,
        answerKey: question.answerKey,
        aiModel: chatModel,
      })),
    );

    // Conspect memory (Phase 8 D3): the class's top-level markdown blocks
    // become CONTENT_CHUNK vectors via the background vectorizer —
    // best-effort, dedup keyed per class, never load-bearing.
    jobs.enqueue(CLASS_CONTENT_VECTORS_JOB, { classId: createdClass.id });

    // Lesson summary (AI_NEXT — the per-lesson memory unit) and the
    // learner-facing snippets (AI_INITIAL) share one embedding call.
    const vectorInputs: { text: string; source: VectorSource }[] = [];
    if (parsed.lessonSummary.trim().length > 0) {
      vectorInputs.push({
        text: parsed.lessonSummary,
        source: VectorSource.AI_NEXT,
      });
    }
    for (const snippet of parsed.contextSnippets) {
      vectorInputs.push({ text: snippet, source: VectorSource.AI_INITIAL });
    }

    if (vectorInputs.length > 0) {
      const embeddings = await ai.generateEmbeddings(
        vectorInputs.map((vector) => vector.text),
      );
      if (!embeddings.ok) {
        return await fail(embeddings.error);
      }
      const tokenCounts = embeddingTokenCounts(
        embeddings.value.usage,
        embeddings.value.embeddings.length,
      );
      const vectors: NewVector[] = embeddings.value.embeddings.map(
        (embedding, i) => ({
          skillId: input.skillId,
          userId: input.userId,
          classId: createdClass.id,
          embedding,
          source: vectorInputs[i].source,
          textSnippet: vectorInputs[i].text,
          classIndex: 0,
          tokenCount: tokenCounts[i],
        }),
      );
      // Best-effort: the lesson is fully persisted by now — a vector-store
      // outage must not fail the skill (the sweeper re-arms nothing for
      // memory; QA/personalization degrade gracefully without the vectors).
      await recordVectors(vectors);
    }

    await skillRepo.update(input.skillId, { status: SkillStatus.ACTIVE });
    generationSucceeded(logCtx, {
      durationMs: Date.now() - startedAt,
      classId: createdClass.id,
      className: parsed.classTitle,
    });
    return { ok: true, value: undefined };

    async function fail(error: GenerateFirstLessonError) {
      await skillRepo.update(input.skillId, { status: SkillStatus.FAILED });
      generationFailed(logCtx, {
        durationMs: Date.now() - startedAt,
        errorKind: error.kind,
        errorDetail: error.detail,
      });
      await eventRepo.record({
        skillId: input.skillId,
        userId: input.userId,
        type: EventType.ERROR_OCCURRED,
        payload: { action: "first_lesson", error },
      });
      return { ok: false as const, error };
    }
  };
