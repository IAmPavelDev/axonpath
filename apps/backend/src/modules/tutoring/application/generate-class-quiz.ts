import {
  generationFailed,
  generationSkipped,
  generationStarted,
  generationSucceeded,
} from "@/lib/generation-logger";

import type { AiPort } from "@/modules/tutoring/ports";
import {
  outcomeForError,
  type RecordAiAttempt,
} from "@/modules/tutoring/infrastructure/ai-attempt.repo";
import {
  buildQuizPrompt,
  QUIZ_SCHEMA,
} from "@/modules/tutoring/domain/prompts";
import { TUTOR_SYSTEM } from "@/modules/tutoring/domain/personas";
import {
  extractJsonObject,
  toGeneratedQuestion,
  type GeneratedQuestion,
} from "@/modules/tutoring/domain/parse";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";

export const CLASS_QUIZ_JOB = "class-quiz";

export type ClassQuizJobPayload = {
  classId: number;
  skillId: number;
  /** The lesson call's own checklist of concepts to test; the quiz prompt
   * falls back to deriving targets from the lesson text when empty. */
  quizTargets: string[];
};

export type GenerateClassQuiz = (input: ClassQuizJobPayload) => Promise<void>;

export type GenerateClassQuizDeps = {
  ai: Pick<AiPort, "generateJson">;
  recordAiAttempt: RecordAiAttempt;
  skillRepo: SkillRepository;
  classRepo: ClassRepository;
  chatModel: string;
};

/**
 * Stage 2.5 of lesson generation: writes the quiz for a finished lesson.
 * Split from the lesson completion (see LESSON_SCHEMA in prompts) — the
 * learner starts reading the conspect while this job generates, and the
 * quiz keeps full coherence because it sees the final lesson text.
 *
 * Retry semantics: any generation/parse failure THROWS so the broker
 * redelivers (adapter budget: 3 attempts, then axon.jobs.dlq). The skill is
 * already ACTIVE — a quiz failure never touches the lesson. Delivery is
 * at-least-once: addQuestions must tolerate redelivery, so a replay with
 * existing questions is a no-op.
 */
export const makeGenerateClassQuiz =
  ({
    ai,
    recordAiAttempt,
    skillRepo,
    classRepo,
    chatModel,
  }: GenerateClassQuizDeps): GenerateClassQuiz =>
  async (input) => {
    const klass = await classRepo.findById(input.classId);
    if (!klass) {
      // Class deleted (skill cascade) between enqueue and consume — nothing
      // to quiz on, and nothing to retry.
      return;
    }
    const skill = await skillRepo.findById(klass.skillId);
    const topic = skill?.topic ?? klass.title;
    const logCtx = {
      pipeline: "class_quiz",
      classId: klass.id,
      className: klass.title,
      skillId: klass.skillId,
    } as const;
    generationStarted(logCtx);
    const startedAt = Date.now();

    // Replay guard: redelivery after a successful persist must not double-
    // write. The question count is the settlement marker.
    const [countRow] = await classRepo.findQuestionCountsByClassIds([klass.id]);
    if ((countRow?.questionCount ?? 0) > 0) {
      generationSkipped(logCtx, {
        durationMs: Date.now() - startedAt,
        reason: "questions already persisted",
      });
      return;
    }

    const prompt = buildQuizPrompt({
      topic,
      lessonTitle: klass.title,
      lessonContentMd: klass.contentMd,
      quizTargets: input.quizTargets,
      mistakes: [],
      review: [],
    });
    const generationStartedAt = Date.now();
    const generation = await ai.generateJson(
      { system: TUTOR_SYSTEM, prompt },
      { schemaName: "class_quiz", responseSchema: QUIZ_SCHEMA },
    );

    if (!generation.ok) {
      recordAiAttempt({
        userId: skill?.userId ?? 0,
        operation: "class_quiz",
        ...outcomeForError(generation.error),
        latencyMs: Date.now() - generationStartedAt,
      });
      generationFailed(logCtx, {
        durationMs: Date.now() - startedAt,
        errorKind: generation.error.kind,
        errorDetail: generation.error.detail,
      });
      throw new Error(`class_quiz generation failed: ${generation.error.detail}`);
    }

    let questions: GeneratedQuestion[];
    try {
      const raw = extractJsonObject(generation.value.raw) as {
        questions?: unknown;
      };
      questions = (Array.isArray(raw.questions) ? raw.questions : [])
        .map(toGeneratedQuestion)
        .filter((q): q is GeneratedQuestion => q !== null);
    } catch (error) {
      recordAiAttempt({
        userId: skill?.userId ?? 0,
        operation: "class_quiz",
        outcome: "parse_failed",
        latencyMs: Date.now() - generationStartedAt,
        rawChars: generation.value.raw.length,
        errorKind: error instanceof Error ? error.message : String(error),
      });
      generationFailed(logCtx, {
        durationMs: Date.now() - startedAt,
        errorKind: "AiResponseInvalid",
        errorDetail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (questions.length === 0) {
      recordAiAttempt({
        userId: skill?.userId ?? 0,
        operation: "class_quiz",
        outcome: "empty",
        latencyMs: Date.now() - generationStartedAt,
        rawChars: generation.value.raw.length,
        errorKind: "model returned no questions",
      });
      generationFailed(logCtx, {
        durationMs: Date.now() - startedAt,
        errorKind: "AiResponseInvalid",
        errorDetail: "model returned no questions",
      });
      throw new Error("class_quiz: model returned no questions");
    }

    recordAiAttempt({
      userId: skill?.userId ?? 0,
      operation: "class_quiz",
      outcome: "ok",
      latencyMs: Date.now() - generationStartedAt,
      promptTokens: generation.value.usage?.promptTokens,
      completionTokens: generation.value.usage?.completionTokens,
      rawChars: generation.value.raw.length,
    });

    await classRepo.addQuestions(
      klass.id,
      klass.skillId,
      questions.map((question) => ({
        type: question.type,
        text: question.text,
        choices: question.choices,
        answerKey: question.answerKey,
        aiModel: chatModel,
      })),
    );
    generationSucceeded(logCtx, {
      durationMs: Date.now() - startedAt,
      count: questions.length,
    });
  };
