import type { NextClassJobRepository } from "@/modules/jobs/next-class-job.repository";
import {
  NEXT_CLASS_LEASE_MINUTES,
  type NextClassWorker,
} from "@/modules/jobs/next-class-worker";

/** Sweeper cadence: every minute, plus once at boot. */
export const NEXT_CLASS_TICK_MS = 60_000;
/** Max skills claimed per tick; the rest wait for the next minute. */
export const NEXT_CLASS_BATCH = 50;

export type NextClassSweeper = {
  start(): void;
  stop(): void;
};

/**
 * The cron: every minute, claim every skill due for its next lesson and start
 * generation as a detached background job. Durable by construction — the
 * claim state lives in Postgres, so a restart (or a crash mid-generation,
 * recovered via the lease) resumes on the next boot tick without losing work.
 */
export const makeNextClassSweeper = ({
  nextClassJobs,
  run,
}: {
  nextClassJobs: NextClassJobRepository;
  run: NextClassWorker["run"];
}): NextClassSweeper => {
  let timer: NodeJS.Timeout | null = null;
  let sweeping = false;

  const tick = async (): Promise<void> => {
    if (sweeping) return;
    sweeping = true;
    try {
      const claims = await nextClassJobs.claim({
        limit: NEXT_CLASS_BATCH,
        leaseMinutes: NEXT_CLASS_LEASE_MINUTES,
      });
      for (const claim of claims) {
        // Detached: a generation runs minutes; the next tick must not wait.
        run(claim).catch((err) => {
          console.error(
            { err, skillId: claim.skillId },
            "Next-class job crashed",
          );
        });
      }
    } catch (err) {
      console.error({ err }, "Next-class sweep failed");
    } finally {
      sweeping = false;
    }
  };

  return {
    start: () => {
      if (timer) return;
      // Boot tick: recover whatever the previous process left behind.
      void tick();
      timer = setInterval(() => void tick(), NEXT_CLASS_TICK_MS);
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
};
