import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { CLASS_QA_ANSWER_JOB } from "@/modules/tutoring/application/answer-class-question";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";

/** Sweeper cadence: every minute, plus once at boot. */
export const CLASS_QA_TICK_MS = 60_000;
/** A PENDING block untouched this long lost its in-process job (restart/crash). */
export const CLASS_QA_STALE_MS = 120_000;
/** Max sweeper requeues per block; past this it is FAILED (client re-asks). */
export const CLASS_QA_MAX_REQUEUES = 3;
/** Max blocks claimed per tick; the rest wait for the next minute. */
export const CLASS_QA_BATCH = 50;

export type ClassQaSweeper = {
  start(): void;
  stop(): void;
};

/**
 * Safety net for ask-class-question: answers ride the in-process setImmediate
 * queue, so a crash/restart mid-generation leaves the block PENDING forever
 * (an eternal skeleton client-side). Mirrors the NextClassJob sweeper: at
 * boot and every minute, claim PENDING blocks untouched for 2 minutes and
 * re-enqueue their answer job. Replay is idempotent — the answer use case
 * no-ops non-PENDING blocks — and every attempt settles ANSWERED or FAILED,
 * so a requeued block always resolves. A block that burned its requeues
 * without ever settling is marked FAILED instead of retried forever.
 */
export const makeClassQaSweeper = ({
  qaRepo,
  jobs,
}: {
  qaRepo: ClassQaRepository;
  jobs: JobQueuePort;
}): ClassQaSweeper => {
  let timer: NodeJS.Timeout | null = null;
  let sweeping = false;

  const tick = async (): Promise<void> => {
    if (sweeping) return;
    sweeping = true;
    try {
      const olderThan = new Date(Date.now() - CLASS_QA_STALE_MS);
      // Terminal first: exhausted blocks fail instead of claiming a batch slot.
      const failed = await qaRepo.failExhausted({
        olderThan,
        maxRequeues: CLASS_QA_MAX_REQUEUES,
      });
      if (failed > 0) {
        console.error(
          { failed },
          "Class-qa blocks exhausted their requeues; marked FAILED",
        );
      }
      const stranded = await qaRepo.claimStranded({
        olderThan,
        maxRequeues: CLASS_QA_MAX_REQUEUES,
        limit: CLASS_QA_BATCH,
      });
      for (const block of stranded) {
        jobs.enqueue(CLASS_QA_ANSWER_JOB, { blockId: block.id });
      }
    } catch (err) {
      console.error({ err }, "Class-qa sweep failed");
    } finally {
      sweeping = false;
    }
  };

  return {
    start: () => {
      if (timer) return;
      // Boot tick: recover whatever the previous process left behind.
      void tick();
      timer = setInterval(() => void tick(), CLASS_QA_TICK_MS);
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
};
