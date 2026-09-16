import type { JobHandler, JobQueuePort } from "@/modules/platform/ports/jobs";

/**
 * In-process job runner with the same fire-and-forget semantics as the old
 * `runDetached` helper: work is deferred off the request path, failures are
 * logged, never propagated to the caller. Replaced by a broker-backed adapter
 * when durable jobs are needed.
 */
export const makeSetImmediateJobQueue = (
  handlers: Record<string, JobHandler>,
): JobQueuePort => ({
  enqueue: (jobName, payload) => {
    const handler = handlers[jobName];
    if (!handler) {
      console.error({ jobName }, "Background job handler not registered");
      return;
    }

    setImmediate(() => {
      Promise.resolve(handler(payload as never)).catch((err) => {
        console.error({ err, jobName }, "Background job failed");
      });
    });
  },
});
