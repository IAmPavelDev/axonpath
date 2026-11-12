import {
  generationFailed,
  generationSkipped,
  generationStarted,
  generationSucceeded,
} from "@/lib/generation-logger";

import { EventType, SkillStatus, VectorSource } from "@/prisma/generated";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { CLASS_CONTENT_VECTORS_JOB } from "@/modules/memory/application/vectorize-class-content";
import { err, ok, type Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import {
  buildNextClassPrompt,
  LESSON_SCHEMA,
} from "@/modules/tutoring/domain/prompts";
import { validateLessonLanguages } from "@/modules/tutoring/domain/lesson-langs";
import { TUTOR_SYSTEM } from "@/modules/tutoring/domain/personas";
import { embeddingTokenCounts } from "@/modules/tutoring/domain/embedding-tokens";
import { extractJsonObject } from "@/modules/tutoring/domain/parse";
import { logger } from "@/lib/logger";
import { CLASS_QUIZ_JOB } from "@/modules/tutoring/application/generate-class-quiz";
import {
  outcomeForError,
  type RecordAiAttempt,
} from "@/modules/tutoring/infrastructure/ai-attempt.repo";
import type { Clock } from "@/modules/platform/ports/clock";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type {
  AnswerReview,
  QuizRepository,
} from "@/modules/learning/domain/quiz/quiz.repository";
import { selectReviewItems } from "@/modules/learning/domain/quiz/review-schedule";
import type { NewVector, VectorStoreError } from "@/modules/memory/ports";

/** Enqueued by submit-quiz after a scored attempt — the submit is the learning signal. */
export const SKILL_NEXT_CLASS_JOB = "skill-next-class";

export type SkillNextClassJobPayload = {
  skillId: number;
  userId: number;
};

export type ParsedNextClass = {
  classTitle: string;
  classContentMd: string;
  baseLanguage: string;
  contentLanguages: string[];
  lessonSummary: string;
  quizTargets: string[];
  contextSnippets: string[];
};

export type GenerateNextClassError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NoClassesYet"; skillId: number }
  | { kind: "AiGenerationFailed"; detail?: string }
  | { kind: "AiResponseInvalid"; detail?: string }
  | { kind: "VectorUpsertFailed"; detail?: string }
  | { kind: "VectorStoreUnavailable"; detail?: string };

/** Retrieval hit narrowed to what the prompt builder needs. */
export type HistoryHit = {
  textSnippet: string;
  source: string;
  classIndex: number | null;
};

export type GenerateNextClassDeps = {
  ai: AiPort;
  recordAiAttempt: RecordAiAttempt;
  /** No excludeSkillId: this skill's own history is wanted here. */
  retrieveContext: (input: {
    userId: number;
    query: string;
    topK?: number;
  }) => Promise<HistoryHit[]>;
  skillRepo: SkillRepository;
  classRepo: ClassRepository;
  quizRepo: QuizRepository;
  eventRepo: EventRepository;
  /** Dates the mastery ledger's staleness math (spiral thresholds). */
  clock: Clock;
  recordVectors: (
    vectors: NewVector[],
  ) => Promise<Result<number[], VectorStoreError>>;
  chatModel: string;
  /** Fire-and-forget queue: class-content vectorization rides it after the commit. */
  jobs: JobQueuePort;
};

export type GenerateNextClassInput = {
  skillId: number;
  userId: number;
};

/** The bound, dependency-complete use case — what the job registry consumes. */
export type GenerateNextClass = (
  input: GenerateNextClassInput,
) => Promise<Result<void, GenerateNextClassError>>;

/**
 * The adaptive loop's engine: generate the next, personalized class for a
 * skill. Runs in the background ("skill-next-class" job, enqueued by
 * submit-quiz after a scored attempt):
 *   1. Resolve the skill and its latest class (NoClassesYet means init has
 *      not finished — permanent, the job must not have run).
 *   2. Read the user's quiz attempts for that class; the latest attempt per
 *      question wins, so retakes do not flood the prompt.
 *   3. Retrieve per-user lesson memory in one call (split by source in the
 *      prompt: AI_NEXT = lessons already covered, AI_INITIAL = learner facts),
 *      and schedule older quiz results for re-testing via the mastery ledger.
 *   4. Generate and audit CLASS_GENERATED.
 *   5. Persist class (index + 1), questions, and vectors (lessonSummary as
 *      AI_NEXT, snippets as AI_INITIAL) so memory keeps compounding.
 *
 * Retrieval failure degrades to no history; generation/parse failure aborts
 * with nothing persisted. The skill stays ACTIVE — clients observe progress
 * via class.list.
 */
export const makeGenerateNextClass =
  ({
    ai,
    recordAiAttempt,
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    eventRepo,
    clock,
    recordVectors,
    chatModel,
    jobs,
  }: GenerateNextClassDeps) =>
  async (
    input: GenerateNextClassInput,
  ): Promise<Result<void, GenerateNextClassError>> => {
    const skill = await skillRepo.findById(input.skillId);
  generationStarted({
    pipeline: "next_class",
    skillId: input.skillId,
    userId: input.userId,
  });
  const pipelineStartedAt = Date.now();
    if (!skill) {
      generationFailed(
        { pipeline: "next_class", skillId: input.skillId, userId: input.userId },
        {
          durationMs: Date.now() - pipelineStartedAt,
          errorKind: "SkillNotFound",
        },
      );
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }

    // Pause gates generation (Phase 7 D2): a skill that is neither ACTIVE
    // nor in its GENERATING phase must not spawn lessons — the submit still
    // scored, the durable job still fired, but this pipeline no-ops with no
    // event and no AI call. GENERATING passes because it IS the generation
    // phase submit-quiz opened for the loop; settlePhase owns it.
    if (
      skill.status !== SkillStatus.ACTIVE &&
      skill.status !== SkillStatus.GENERATING
    ) {
      generationSkipped(
        {
          pipeline: "next_class",
          skillId: input.skillId,
          skillName: skill.topic,
          userId: input.userId,
        },
        {
          durationMs: Date.now() - pipelineStartedAt,
          reason: `skill status ${skill.status} is neither ACTIVE nor GENERATING`,
        },
      );
      return ok(undefined);
    }

    const last = await classRepo.findTopBySkill(input.skillId);
    if (!last) {
      generationFailed(
        {
          pipeline: "next_class",
          skillId: input.skillId,
          skillName: skill.topic,
          userId: input.userId,
        },
        {
          durationMs: Date.now() - pipelineStartedAt,
          errorKind: "NoClassesYet",
        },
      );
      return err({ kind: "NoClassesYet", skillId: input.skillId });
    }

    // submit-quiz flipped the skill into GENERATING (the
    // settling it: every exit past this point — success, dedup no-op, or
    // failure — ends the phase, because the skill keeps its existing classes
    // either way. A skill that was not GENERATING on entry (PAUSED, or
    // GENERATING from an init still in flight) is left untouched — its
    // status is not ours.
    const phaseStarted = skill.status === SkillStatus.GENERATING;
    const settlePhase = async (): Promise<void> => {
      if (phaseStarted) {
        await skillRepo.update(input.skillId, { status: SkillStatus.ACTIVE });
      }
    };

    // Retake dedup: submit-quiz enqueues on every scored submit, so a
    // consecutive retake of the newest class must not spawn another variant.
    // Generate only when the learner has answered through the newest class;
    // with no recorded answers (anomalous job replay) generation is the safe
    // default. A retake of an older class still signals learning and
    // regenerates from the latest one.
    const answeredIndex = await quizRepo.findHighestAnsweredClassIndex(
      input.skillId,
      input.userId,
    );
    if (answeredIndex !== null && last && last.index > answeredIndex) {
      generationSkipped(
        {
          pipeline: "next_class",
          skillId: input.skillId,
          skillName: skill.topic,
          userId: input.userId,
        },
        {
          durationMs: Date.now() - pipelineStartedAt,
          reason: "newest class not answered through yet (retake dedup)",
        },
      );
      await settlePhase();
      return ok(undefined);
    }

    // Latest attempt per question wins: answers arrive id-asc, so a Map keyed
    // by questionId keeps the newest row per question.
    const latestByQuestion = new Map<number, AnswerReview>();
    for (const review of await quizRepo.findAnswersByClassAndUser(
      last.id,
      input.userId,
    )) {
      latestByQuestion.set(review.questionId, review);
    }
    const attempts = [...latestByQuestion.values()];
    const mistakes = attempts
      .filter((attempt) => attempt.isCorrect === false)
      .map(({ questionText, userAnswer, correctAnswer }) => ({
        questionText,
        userAnswer,
        correctAnswer,
      }));
    const allCorrect = attempts.length > 0 && mistakes.length === 0;

    // Mastery ledger: older quiz results across the whole skill, scheduled
    // by the pure review policy (reteach/reinforce/spiral, capped).
    const review = selectReviewItems(
      await quizRepo.findReviewCandidatesBySkill(input.skillId, input.userId),
      { topClassIndex: last.index, now: clock.now() },
    );

    // One retrieval call for both history blocks; degrades to [] on failure.
    const history = await retrieveContext({
      userId: input.userId,
      query: `${skill.topic} ${last.title}`,
      topK: 12,
    });
    const lastSummaryHit = history.find(
      (hit) =>
        hit.source === VectorSource.AI_NEXT && hit.classIndex === last.index,
    );
    const priorHistory = lastSummaryHit
      ? history.filter((hit) => hit !== lastSummaryHit)
      : history;

    const prompt = buildNextClassPrompt({
      topic: skill.topic,
      lastTitle: last.title,
      lastSummary: lastSummaryHit?.textSnippet,
      history: priorHistory,
      mistakes,
      allCorrect,
      review,
    });

    const generationStartedAt = Date.now();
    const generation = await ai.generateJson(
      { system: TUTOR_SYSTEM, prompt },
      { schemaName: "next_class", responseSchema: LESSON_SCHEMA },
    );
    if (!generation.ok) {
      recordAiAttempt({
        userId: input.userId,
        operation: "next_class",
        ...outcomeForError(generation.error),
        latencyMs: Date.now() - generationStartedAt,
      });
      generationFailed(
        {
          pipeline: "next_class",
          skillId: input.skillId,
          skillName: skill.topic,
          userId: input.userId,
        },
        {
          durationMs: Date.now() - pipelineStartedAt,
          errorKind: generation.error.kind,
          errorDetail: generation.error.detail,
        },
      );
      await settlePhase();
      return { ok: false, error: generation.error };
    }

    let parsed: ParsedNextClass;
    try {
      // Named cast: untrusted model output; every field re-validated below.
      const raw = extractJsonObject(
        generation.value.raw,
      ) as Partial<ParsedNextClass>;
      parsed = {
        classTitle: raw.classTitle ?? "Unknown title",
        classContentMd: raw.classContentMd ?? "",
        baseLanguage: raw.baseLanguage ?? "",
        contentLanguages: Array.isArray(raw.contentLanguages)
          ? raw.contentLanguages.filter((l): l is string => typeof l === "string")
          : [],
        lessonSummary: raw.lessonSummary ?? "",
        quizTargets: Array.isArray(raw.quizTargets)
          ? raw.quizTargets.filter((t): t is string => typeof t === "string")
          : [],
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
        operation: "next_class",
        outcome: "parse_failed",
        latencyMs: Date.now() - generationStartedAt,
        rawChars: generation.value.raw.length,
        errorKind: error instanceof Error ? error.message : String(error),
      });
      generationFailed(
        {
          pipeline: "next_class",
          skillId: input.skillId,
          skillName: skill.topic,
          userId: input.userId,
        },
        {
          durationMs: Date.now() - pipelineStartedAt,
          errorKind: "AiResponseInvalid",
          errorDetail: error instanceof Error ? error.message : String(error),
        },
      );
      await settlePhase();
      return {
        ok: false,
        error: {
          kind: "AiResponseInvalid",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }

    // The quiz ships via CLASS_QUIZ_JOB against the finished lesson text —
    // the lesson call emits quizTargets only. The reconciler tolerates a
    // newest class with zero questions (no submissions possible yet); the
    // quiz lands within the broker retry budget.

    recordAiAttempt({
      userId: input.userId,
      operation: "next_class",
      outcome: "ok",
      latencyMs: Date.now() - generationStartedAt,
      promptTokens: generation.value.usage?.promptTokens,
      completionTokens: generation.value.usage?.completionTokens,
      rawChars: generation.value.raw.length,
    });

    // Audit CLASS_GENERATED with the full request + response for debugging.
    await eventRepo.record({
      skillId: input.skillId,
      userId: input.userId,
      type: EventType.CLASS_GENERATED,
      payload: {
        action: "next_class",
        prompt,
        system: TUTOR_SYSTEM,
        model: chatModel,
        usage: generation.value.usage,
        response: generation.value.raw,
      },
    });

    const classIndex = (last?.index ?? -1) + 1;
    const createdClass = await classRepo.create({
      skillId: input.skillId,
      index: classIndex,
      title: parsed.classTitle,
      contentMd: parsed.classContentMd,
      baseLanguage: parsed.baseLanguage,
      aiModel: chatModel,
    });

    // Learner-visible artifact first: settle ACTIVE before the background
    // enrichments (quiz job, vectors, clips).
    await skillRepo.update(input.skillId, { status: SkillStatus.ACTIVE });

    // Quiz: separate broker job against the finished lesson text.
    jobs.enqueue(CLASS_QUIZ_JOB, {
      classId: createdClass.id,
      skillId: input.skillId,
      quizTargets: parsed.quizTargets,
    });

    // Conspect memory (Phase 8 D3): the class's top-level markdown blocks
    // become CONTENT_CHUNK vectors via the background vectorizer —
    // best-effort, dedup keyed per class, never load-bearing.
    jobs.enqueue(CLASS_CONTENT_VECTORS_JOB, { classId: createdClass.id });

    // Memory compounding: the lesson summary is the AI_NEXT memory unit, the
    // learner-facing snippets continue the AI_INITIAL series. One embedding
    // call for both.
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
        // Best-effort: the lesson is persisted and the skill already ACTIVE —
        // memory degradation must not fail the generation.
        logger.warn(
          {
            pipeline: "next_class",
            skillId: input.skillId,
            detail: embeddings.error.detail,
          },
          "Memory embedding failed; continuing without vectors",
        );
      } else {
        const tokenCounts = embeddingTokenCounts(
          embeddings.value.usage,
          embeddings.value.embeddings.length,
        );
        const recorded = await recordVectors(
          embeddings.value.embeddings.map((embedding, i) => ({
            skillId: input.skillId,
            userId: input.userId,
            classId: createdClass.id,
            embedding,
            source: vectorInputs[i].source,
            textSnippet: vectorInputs[i].text,
            classIndex,
            tokenCount: tokenCounts[i],
          })),
        );
        if (!recorded.ok) {
          logger.warn(
            {
              pipeline: "next_class",
              skillId: input.skillId,
              detail: recorded.error.detail,
            },
            "Memory vector store write failed; continuing without vectors",
          );
        }
      }
    }

    await settlePhase();
    generationSucceeded(
      {
        pipeline: "next_class",
        skillId: input.skillId,
        skillName: skill.topic,
        userId: input.userId,
      },
      {
        durationMs: Date.now() - pipelineStartedAt,
        classId: createdClass.id,
        className: parsed.classTitle,
      },
    );
    return ok(undefined);
  };
