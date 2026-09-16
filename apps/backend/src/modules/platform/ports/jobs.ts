/**
 * Background job seam. The default adapter runs jobs in-process via
 * setImmediate (same semantics as the old `runDetached`). A real broker
 * (RabbitMQ) or an Effect-based runner replaces the adapter without touching
 * any use case.
 *
 * Payloads are untyped at the port level; the composition root registers a
 * typed handler map so misuse is caught at wiring time.
 */
export interface JobQueuePort {
  enqueue(jobName: string, payload: unknown): void;
}

export type JobHandler = (payload: never) => Promise<unknown>;
