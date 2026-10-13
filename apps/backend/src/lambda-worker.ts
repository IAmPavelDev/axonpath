import type { Container } from "@/container";
import { configureContainer } from "@/container";

// Built once per cold start; reused by every warm invocation.
let booted: Promise<Container> | null = null;

/**
 * The scheduled drain (EventBridge Scheduler → this handler, every minute):
 * one next-class sweep — reconcile, claim, run every generation to
 * completion — one class-qa sweep — re-enqueue stranded answer blocks — then
 * wait for every setImmediate job, including follow-up miners, to settle.
 * Returning before `jobQueueIdle()` resolves would freeze the container
 * mid-job; claims and leases would still recover the work on a later tick,
 * but waiting is the fast path.
 */
export const workerHandler = async (): Promise<void> => {
  booted ??= Promise.resolve(configureContainer({ sweeperMode: "worker" }));
  const container = await booted;

  await container.nextClassSweeper.tickOnce();
  await container.classQaSweeper.tickOnce();
  await container.skillInitSweeper.tickOnce();
  await container.skillOptionsSweeper.tickOnce();
  await container.gradingSweeper.tickOnce();
  await container.recommendationsSweeper.tickOnce();
  await container.classClipsSweeper.tickOnce();
  await container.jobQueueIdle();
};
