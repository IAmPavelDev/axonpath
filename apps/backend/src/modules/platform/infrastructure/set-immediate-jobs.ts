import { logger } from "@/lib/logger";

import type { JobHandler, JobQueuePort } from "@/modules/platform/ports/jobs";

/**
 * In-process job runner with the same fire-and-forget semantics as the old
 * `runDetached` helper: work is deferred off the request path, failures are
 * logged, never propagated to the caller. Replaced by a broker-backed adapter
 * when durable jobs are needed.
 *
 * `idle()` is the drain seam for the Lambda worker: it resolves once every
 * enqueued job — including follow-ups enqueued by jobs themselves — has
 * settled. A parent's counter stays raised until its body finishes, so a
 * child enqueued mid-run can never let `idle()` resolve early.
 */
export type SetImmediateJobQueue = JobQueuePort & { idle(): Promise<void> };

export const makeSetImmediateJobQueue = (
  handlers: Record<string, JobHandler>,
): SetImmediateJobQueue => {
  let pending = 0;
  let drainWaiters: Array<() => void> = [];

  const settle = (): void => {
    pending -= 1;
    if (pending === 0 && drainWaiters.length > 0) {
      const waiters = drainWaiters;
      drainWaiters = [];
      for (const wake of waiters) wake();
    }
  };

  return {
    enqueue: (jobName, payload) => {
      const handler = handlers[jobName];
      if (!handler) {
        logger.error({ jobName }, "Background job handler not registered");
        return;
      }

      pending += 1;
      setImmediate(() => {
        Promise.resolve(handler(payload as never)).then(settle, (err) => {
          logger.error({ err, jobName }, "Background job failed");
          settle();
        });
      });
    },

    idle: (): Promise<void> => {
      if (pending === 0) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      drainWaiters.push(resolve);
      return promise;
    },
  };
};
