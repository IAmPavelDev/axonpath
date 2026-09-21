import { err, ok, type Result } from "@/modules/platform/result";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  SKILL_NEXT_CLASS_JOB,
  type SkillNextClassJobPayload,
} from "@/modules/tutoring/application/generate-next-class";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { QuizError, SubmittedAnswer } from "@/modules/learning/domain/quiz/question";
import { scoreAnswer } from "@/modules/learning/domain/quiz/scoring";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";

export type SubmitQuizDeps = {
  quizRepo: QuizRepository;
  eventRepo: EventRepository;
  jobs: JobQueuePort;
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
 * A scored attempt is the learning signal: it enqueues skill-next-class so
 * the next, personalized lesson starts generating immediately (clients just
 * observe class.list). No dedup in beta — a retake regenerates a variant.
 */
export const makeSubmitQuiz =
  ({ quizRepo, eventRepo, jobs }: SubmitQuizDeps) =>
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

    await quizRepo.createAnswers(
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

    if (scored.length > 0) {
      jobs.enqueue(SKILL_NEXT_CLASS_JOB, {
        skillId: scored[0].question.skillId,
        userId: input.userId,
      } satisfies SkillNextClassJobPayload);
    }

    return ok({ score, total: scored.length, perQuestion });
  };
