import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  GRADE_OPEN_ENDED_JOB,
  type GradeOpenEndedJobPayload,
} from "@/modules/tutoring/application/grade-open-ended";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import { makeMinuteSweeper, type MinuteSweeper } from "./minute-sweeper";

/** An open-ended answer ungraded this long lost its grading job. */
export const GRADING_STALE_MS = 120_000;
/** Max answers claimed per tick; the rest wait for the next minute. */
export const GRADING_BATCH = 100;

export type GradingSweeper = MinuteSweeper;

/**
 * Recovery net for open-ended grading: submit-quiz enqueues the grading job
 * in-process, which the serverless API freezes before it runs. Without this
 * net the answers sit isCorrect = null forever — the client's "Grading…"
 * pill never resolves. Each tick re-enqueues stale ungraded answers.
 * Self-terminating: a grading run settles every entry (verdict or the
 * "Grading failed" row), so even a dead provider cannot loop the requeue.
 */
export const makeGradingSweeper = ({
  quizRepo,
  jobs,
}: {
  quizRepo: Pick<QuizRepository, "listPendingGradingIds">;
  jobs: JobQueuePort;
}): GradingSweeper =>
  makeMinuteSweeper(async () => {
    try {
      const ids = await quizRepo.listPendingGradingIds(
        new Date(Date.now() - GRADING_STALE_MS),
        GRADING_BATCH,
      );
      if (ids.length > 0) {
        jobs.enqueue(GRADE_OPEN_ENDED_JOB, {
          answerIds: ids,
        } satisfies GradeOpenEndedJobPayload);
        console.warn(
          { requeued: ids },
          "Requeued lost open-ended grading jobs",
        );
      }
    } catch (err) {
      console.error({ err }, "Grading sweep failed");
    }
  });
