/** Sweeper cadence shared by every recovery sweeper: 60s interval, one boot tick. */
export const MINUTE_TICK_MS = 60_000;

export type MinuteSweeper = {
  start(): void;
  stop(): void;
  /**
   * One synchronous sweep to completion. The Lambda worker calls this on a
   * schedule; server mode uses start()'s interval instead.
   */
  tickOnce(): Promise<void>;
};

/**
 * The interval shell around a recovery tick: overlapping ticks are dropped
 * (a sweep never runs concurrently with itself), the boot tick recovers work
 * orphaned by the previous process, and the Lambda worker calls tickOnce
 * directly — a detached interval would be frozen dead the moment the handler
 * returned. The tick body owns its own error handling.
 */
export const makeMinuteSweeper = (tick: () => Promise<void>): MinuteSweeper => {
  let timer: NodeJS.Timeout | null = null;
  let sweeping = false;

  const guarded = async (): Promise<void> => {
    if (sweeping) return;
    sweeping = true;
    try {
      await tick();
    } finally {
      sweeping = false;
    }
  };

  return {
    start: () => {
      if (timer) return;
      void guarded();
      timer = setInterval(() => void guarded(), MINUTE_TICK_MS);
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    tickOnce: guarded,
  };
};
