import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NextClassJobClaim,
  NextClassJobRepository,
} from "@/modules/jobs/next-class-job.repository";
import { makeNextClassSweeper } from "@/modules/jobs/next-class-sweeper";

const CLAIM: NextClassJobClaim = {
  skillId: 10,
  userId: 7,
  attempts: 1,
  claimedAt: new Date(),
  target: null,
};

const makeDeps = () => {
  const nextClassJobs: NextClassJobRepository = {
    enqueue: vi.fn(),
    claim: vi.fn(async () => [CLAIM]),
    claimOne: vi.fn(async () => null),
    release: vi.fn(),
    requeue: vi.fn(),
    existsPending: vi.fn(async () => false),
  };
  const reconcile = vi.fn(async () => {});
  const run = vi.fn(async () => {});
  return { nextClassJobs, reconcile, run };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("makeNextClassSweeper", () => {
  it("ticks immediately on start and claims due skills", async () => {
    vi.useFakeTimers();
    const { nextClassJobs, reconcile, run } = makeDeps();
    const sweeper = makeNextClassSweeper({ reconcile, nextClassJobs, run });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);

    // Reconcile runs inside the tick, before the claim.
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(nextClassJobs.claim).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(CLAIM);
    sweeper.stop();
  });

  it("keeps ticking every minute and fires each claim detached", async () => {
    vi.useFakeTimers();
    const { nextClassJobs, reconcile, run } = makeDeps();
    const sweeper = makeNextClassSweeper({ reconcile, nextClassJobs, run });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(nextClassJobs.claim).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledTimes(3);
    sweeper.stop();
  });

  it("does not tick after stop", async () => {
    vi.useFakeTimers();
    const { nextClassJobs, reconcile, run } = makeDeps();
    const sweeper = makeNextClassSweeper({ reconcile, nextClassJobs, run });

    sweeper.start();
    sweeper.stop();
    await vi.advanceTimersByTimeAsync(120_000);

    // The synchronous boot tick already started inside start(); stop() only
    // guarantees no further interval ticks.
    expect(nextClassJobs.claim).toHaveBeenCalledTimes(1);
  });

  it("skips a tick while the previous claim is still in flight", async () => {
    vi.useFakeTimers();
    const { nextClassJobs, reconcile, run } = makeDeps();
    let releaseClaim: (() => void) | undefined;
    nextClassJobs.claim = vi.fn(
      () =>
        new Promise<NextClassJobClaim[]>((resolve) => {
          releaseClaim = () => resolve([CLAIM]);
        }),
    );
    const sweeper = makeNextClassSweeper({ reconcile, nextClassJobs, run });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(nextClassJobs.claim).toHaveBeenCalledTimes(1);

    releaseClaim?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledWith(CLAIM);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(nextClassJobs.claim).toHaveBeenCalledTimes(2);
    sweeper.stop();
  });

  it("logs and survives a claim failure", async () => {
    vi.useFakeTimers();
    const { nextClassJobs, reconcile, run } = makeDeps();
    nextClassJobs.claim = vi.fn(async () => {
      throw new Error("db down");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const sweeper = makeNextClassSweeper({ reconcile, nextClassJobs, run });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(nextClassJobs.claim).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
    sweeper.stop();
    consoleError.mockRestore();
  });

});

describe("next-class sweeper worker mode", () => {
  it("tickOnce awaits each run to completion", async () => {
    const { nextClassJobs, reconcile, run } = makeDeps();
    const { promise: gated, resolve: release } = Promise.withResolvers<void>();
    run.mockImplementation(async () => {
      await gated;
    });
    const sweeper = makeNextClassSweeper({
      reconcile,
      nextClassJobs,
      run,
      awaitRuns: true,
    });

    let settled = false;
    const tick = sweeper.tickOnce().then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(CLAIM));
    // The run is still gated open — an awaiting tickOnce must not have
    // resolved past it (a detached tick would have).
    expect(settled).toBe(false);

    release();
    await tick;
    expect(settled).toBe(true);
  });

  it("server mode: tickOnce resolves without waiting for the detached run", async () => {
    const { nextClassJobs, reconcile, run } = makeDeps();
    const { promise: gated, resolve: release } = Promise.withResolvers<void>();
    run.mockImplementation(() => gated);
    const sweeper = makeNextClassSweeper({ reconcile, nextClassJobs, run });

    await sweeper.tickOnce();

    // Fire-and-forget: the tick returned while the generation still runs.
    expect(run).toHaveBeenCalledWith(CLAIM);
    release();
  });
});
