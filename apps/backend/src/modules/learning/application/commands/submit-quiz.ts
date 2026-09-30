import { err, ok, type Result } from "@/modules/platform/result";
import { SkillStatus } from "@/prisma/generated";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  SKILL_NEXT_CLASS_JOB,
  type SkillNextClassJobPayload,
} from "@/modules/tutoring/application/generate-next-class";
import { canTransition } from "@/modules/learning/domain/skill/skill";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { NextClassJobRepository } from "@/modules/jobs/next-class-job.repository";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { QuizError, SubmittedAnswer } from "@/modules/learning/domain/quiz/question";
import {
  ANSWER_VECTORS_CAP,
  SKILL_ANSWER_VECTORS_JOB,
  type SkillAnswerVectorsJobPayload,
} from "@/modules/memory/application/mine-answer-vectors";
import { scoreAnswer } from "@/modules/learning/domain/quiz/scoring";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
export type SubmitQuizDeps = {
  quizRepo: QuizRepository;
  eventRepo: EventRepository;
  skillRepo: SkillRepository;
  jobs: JobQueuePort;
  nextClassJobs: NextClassJobRepository;
};
export type SubmitQuizInput = {
  classId: number;
  userId: number;
  answers: SubmittedAnswer[];
};
export type QuestionResult = {
  questionId: number;
  isCorrect: boolean;
  correctAnswer: string | null;
};
export type SubmitQuizOutput = {
  score: number;
  total: number;
  perQuestion: QuestionResult[];
};

/**
 * Score a quiz attempt and persist it. Question ids the client sends that
 * don't belong to this class are skipped, not rejected — they cannot be
 * scored and must not persist. A class with no questions is ClassNotFound:
 * nothing to score and no skill attribution.
 *
 * A scored attempt is the learning signal: it flips the skill into its
 * GENERATING phase (the user-visible "composing your next lesson" state),
 * marks it due via the durable row (survives restarts, unique per skill so
 * retakes re-arm instead of stacking) and fires the instant in-process job
 * so generation usually starts immediately. If that job is lost, the minute
 * sweeper picks the row up. The next-class pipeline settles the status back
 * to ACTIVE. Clients just observe class.list.
 */
export const makeSubmitQuiz =
  ({ quizRepo, eventRepo, skillRepo, jobs, nextClassJobs }: SubmitQuizDeps) =>
  async (input: SubmitQuizInput): Promise<Result<SubmitQuizOutput, QuizError>> => {
    const questions = await quizRepo.findScoreableByClassId(input.classId);
    if (questions.length === 0) {
      return err({ kind: "ClassNotFound", classId: input.classId });
    }

    const byId = new Map(questions.map((question) => [question.id, question]));
    const scored = input.answers.flatMap((submitted) => {
      const question = byId.get(submitted.questionId);
      if (!question) {
        return [];
      }
      return [{ question, submitted, ...scoreAnswer(question, submitted) }];
    });

    const score = scored.reduce((sum, entry) => sum + entry.score, 0);

    const answerIds = await quizRepo.createAnswers(
      scored.map(({ question, submitted, isCorrect, score }) => ({
        questionId: question.id,
        userId: input.userId,
        skillId: question.skillId,
        content: { answer: submitted.answer },
        score,
        isCorrect,
        timeSpentMs: submitted.timeSpentMs ?? 0,
      })),
    );

    if (scored.length > 0) {
      const skillId = scored[0].question.skillId;
      // Memory: wrong machine-gradable answers become ANSWER_DERIVED vectors
      // (Phase 7 D3) — one background job per submit, capped so a disaster
      // quiz cannot flood the embedder. Dedup is keyed by answerId, so
      // retakes re-enqueue harmlessly.
      const wrongAnswerIds = scored
        .map((entry, i) => ({ entry, answerId: answerIds[i] }))
        .filter(
          ({ entry }) =>
            entry.isCorrect === false &&
            (entry.question.type === "MULTIPLE_CHOICE" ||
              entry.question.type === "TRUE_FALSE"),
        )
        .map(({ answerId }) => answerId)
        .slice(0, ANSWER_VECTORS_CAP);
      if (wrongAnswerIds.length > 0) {
        jobs.enqueue(SKILL_ANSWER_VECTORS_JOB, {
          skillId,
          userId: input.userId,
          answerIds: wrongAnswerIds,
        } satisfies SkillAnswerVectorsJobPayload);
      }

      // Durable row first: if the process dies before the flip or before the
      // in-memory job fires, the sweeper still picks the skill up — an
      // ACTIVE-or-GENERATING skill is never left with a lost signal.
      await nextClassJobs.enqueue({ skillId, userId: input.userId });

      // The user-visible phase change. Illegal from PAUSED/COMPLETED/
      // ARCHIVED — the flip is only for learnable skills; generation itself
      // is not gated here.
      const skill = await skillRepo.findById(skillId);
      if (skill && canTransition(skill.status as SkillStatus, SkillStatus.GENERATING)) {
        await skillRepo.update(skillId, { status: SkillStatus.GENERATING });
      }
      jobs.enqueue(SKILL_NEXT_CLASS_JOB, {
        skillId,
        userId: input.userId,
      } satisfies SkillNextClassJobPayload);
    }

    const perQuestion = scored.map(({ question, isCorrect }) => ({
      questionId: question.id,
      isCorrect,
      correctAnswer:
        typeof question.answerKey === "string" ? question.answerKey : null,
    }));

    await eventRepo.record({
      skillId: questions[0].skillId,
      userId: input.userId,
      type: "ANSWER_SUBMITTED",
      payload: { classId: input.classId, score, total: scored.length },
    });

    return ok({ score, total: scored.length, perQuestion });
  };
