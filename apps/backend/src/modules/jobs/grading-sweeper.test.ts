import { describe, expect, it, vi } from "vitest";
import {
  makeGradingSweeper,
  GRADING_STALE_MS,
  GRADING_BATCH,
} from "./grading-sweeper";
import { GRADE_OPEN_ENDED_JOB } from "@/modules/tutoring/application/grade-open-ended";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";

const makeDeps = (ids: number[]) => {
  const listPendingGradingIds = vi.fn(
    async (_olderThan: Date, _limit: number) => ids,
  );
  const enqueued: { jobName: string; payload: unknown }[] = [];
  const quizRepo: Pick<QuizRepository, "listPendingGradingIds"> = {
    listPendingGradingIds,
  };
  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };
  return {
    sweeper: makeGradingSweeper({ quizRepo, jobs }),
    listPendingGradingIds,
    enqueued,
  };
};

describe("gradingSweeper", () => {
  it("re-enqueues grading for stale ungraded open-ended answers", async () => {
    const { sweeper, listPendingGradingIds, enqueued } = makeDeps([1001, 1002]);

    await sweeper.tickOnce();

    const [cutoff, limit] = listPendingGradingIds.mock.calls[0];
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(
      GRADING_STALE_MS,
    );
    expect(limit).toBe(GRADING_BATCH);
    expect(enqueued).toEqual([
      { jobName: GRADE_OPEN_ENDED_JOB, payload: { answerIds: [1001, 1002] } },
    ]);
  });

  it("enqueues nothing when grading is settled", async () => {
    const { sweeper, enqueued } = makeDeps([]);

    await sweeper.tickOnce();

    expect(enqueued).toEqual([]);
  });
});
