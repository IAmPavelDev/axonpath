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
  /**
   * One synchronous sweep to completion. The Lambda worker calls this on a
   * schedule; server mode never does (it uses start()'s interval instead).
   */
  tickOnce(): Promise<void>;
};

/**
 * The cron: every minute, reconcile the skills directory (re-arm any ACTIVE
 * skill whose learner answered through the newest class but has no marker),
 * then claim every due marker and start generation. Server mode runs each
 * generation detached so a slow one never blocks the tick loop; Lambda
 * worker mode awaits them inline (see `awaitRuns`).
 */
export const makeNextClassSweeper = ({
  reconcile,
  nextClassJobs,
  run,
  awaitRuns = false,
}: {
  /** Safety net: re-arm due skills the normal signals missed. */
  reconcile: () => Promise<void>;
  nextClassJobs: NextClassJobRepository;
  run: NextClassWorker["run"];
  /**
   * false (server mode): generations run detached so a slow generation never
   * blocks the tick loop. true (Lambda worker mode): the tick awaits every
   * run — a detached promise would be frozen dead the moment the handler
   * returns, so inline awaiting is the only way the work survives.
   */
  awaitRuns?: boolean;
}): NextClassSweeper => {
  let timer: NodeJS.Timeout | null = null;
  let sweeping = false;

  const tick = async (): Promise<void> => {
    if (sweeping) return;
    sweeping = true;
    try {
      // Reconcile first so a re-armed skill is claimed in the same tick.
      await reconcile();
      const claims = await nextClassJobs.claim({
        limit: NEXT_CLASS_BATCH,
        leaseMinutes: NEXT_CLASS_LEASE_MINUTES,
      });
      for (const claim of claims) {
        if (awaitRuns) {
          // Lambda worker: a detached promise dies when the handler returns,
          // so the generation is awaited to completion instead.
          await run(claim);
        } else {
          // Server: detached — a generation runs minutes; the next tick
          // must not wait.
          run(claim).catch((err) => {
            console.error(
              { err, skillId: claim.skillId },
              "Next-class job crashed",
            );
          });
        }
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
    tickOnce: tick,
  };
};
