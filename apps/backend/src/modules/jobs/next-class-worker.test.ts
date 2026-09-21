import { describe, expect, it, vi } from "vitest";
import { ok, type Result } from "@/modules/platform/result";
import type {
  NextClassJobClaim,
  NextClassJobRepository,
} from "@/modules/jobs/next-class-job.repository";
import {
  makeNextClassWorker,
  MAX_NEXT_CLASS_ATTEMPTS,
} from "@/modules/jobs/next-class-worker";
import type {
  GenerateNextClass,
  GenerateNextClassError,
} from "@/modules/tutoring/application/generate-next-class";

const CLAIM: NextClassJobClaim = {
  skillId: 10,
  userId: 7,
  attempts: 1,
  claimedAt: new Date("2026-09-22T10:00:00Z"),
};

const okResult: Result<void, GenerateNextClassError> = ok(undefined);
const failedResult: Result<void, GenerateNextClassError> = {
  ok: false,
  error: { kind: "AiGenerationFailed", detail: "down" },
};

const makeDeps = (result: Result<void, GenerateNextClassError> = okResult) => {
  const generateNextClass: GenerateNextClass = vi.fn(async () => result);
  const nextClassJobs = {
    enqueue: vi.fn(),
    claim: vi.fn(async (): Promise<NextClassJobClaim[]> => []),
    claimOne: vi.fn(async (): Promise<NextClassJobClaim | null> => null),
    release: vi.fn(),
    requeue: vi.fn(),
  };
  return {
    deps: {
      nextClassJobs: nextClassJobs as NextClassJobRepository,
      generateNextClass,
    },
    nextClassJobs,
    generateNextClass,
  };
};

describe("makeNextClassWorker", () => {
  it("runs generation for the claim and releases the marker on success", async () => {
    const { deps, nextClassJobs, generateNextClass } = makeDeps();

    await makeNextClassWorker(deps).run(CLAIM);

    expect(generateNextClass).toHaveBeenCalledWith({ skillId: 10, userId: 7 });
    expect(nextClassJobs.release).toHaveBeenCalledWith(CLAIM);
    expect(nextClassJobs.requeue).not.toHaveBeenCalled();
  });

  it("requeues the claim after a failed attempt below the cap", async () => {
    const { deps, nextClassJobs } = makeDeps(failedResult);

    await makeNextClassWorker(deps).run(CLAIM);

    expect(nextClassJobs.requeue).toHaveBeenCalledWith(CLAIM);
    expect(nextClassJobs.release).not.toHaveBeenCalled();
  });

  it("releases the claim (gives up) at the attempt cap", async () => {
    const { deps, nextClassJobs } = makeDeps(failedResult);
    const finalAttempt: NextClassJobClaim = {
      ...CLAIM,
      attempts: MAX_NEXT_CLASS_ATTEMPTS,
    };

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      await makeNextClassWorker(deps).run(finalAttempt);
    } finally {
      consoleError.mockRestore();
    }

    expect(nextClassJobs.release).toHaveBeenCalledWith(finalAttempt);
    expect(nextClassJobs.requeue).not.toHaveBeenCalled();
  });

  it("runForSkill claims the skill's marker and runs it", async () => {
    const { deps, nextClassJobs, generateNextClass } = makeDeps();
    nextClassJobs.claimOne.mockResolvedValue(CLAIM);

    const ran = await makeNextClassWorker(deps).runForSkill(10);

    expect(ran).toBe(true);
    expect(nextClassJobs.claimOne).toHaveBeenCalledWith({
      skillId: 10,
      leaseMinutes: expect.any(Number),
    });
    expect(generateNextClass).toHaveBeenCalled();
  });

  it("runForSkill is a no-op when the marker is absent or already owned", async () => {
    const { deps, generateNextClass } = makeDeps();

    const ran = await makeNextClassWorker(deps).runForSkill(10);

    expect(ran).toBe(false);
    expect(generateNextClass).not.toHaveBeenCalled();
  });
});
