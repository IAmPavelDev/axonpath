import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  CLASS_QA_MAX_REQUEUES,
  makeClassQaSweeper,
} from "@/modules/jobs/class-qa-sweeper";
import { CLASS_QA_ANSWER_JOB } from "@/modules/tutoring/application/answer-class-question";
import { ClassQaStatus } from "@/prisma/generated";

type Block = {
  id: number;
  status: ClassQaStatus;
  updatedAt: Date;
  requeueCount: number;
};

const block = (overrides: Partial<Block> = {}): Block => ({
  id: 1,
  status: ClassQaStatus.PENDING,
  // Stranded: untouched well past the 2-minute cutoff.
  updatedAt: new Date(Date.now() - 3 * 60_000),
  requeueCount: 0,
  ...overrides,
});

/** In-memory stand-in for the prisma repo, mirroring the claim SQL semantics. */
const makeDeps = (blocks: Block[]) => {
  const qaRepo: ClassQaRepository = {
    resetForRetry: async () => {
      throw new Error("not used in sweeper tests");
    },
    create: async () => {
      throw new Error("not used in sweeper tests");
    },
    listByClass: async () => {
      throw new Error("not used in sweeper tests");
    },
    listAnsweredByClass: async () => {
      throw new Error("not used in sweeper tests");
    },
    findById: async () => {
      throw new Error("not used in sweeper tests");
    },
    answer: async () => {
      throw new Error("not used in sweeper tests");
    },
    markFailed: async () => {
      throw new Error("not used in sweeper tests");
    },
    claimStranded: vi.fn(async ({ olderThan, maxRequeues, limit }) => {
      const stranded = blocks
        .filter(
          (b) =>
            b.status === ClassQaStatus.PENDING &&
            b.updatedAt < olderThan &&
            b.requeueCount < maxRequeues,
        )
        .slice(0, limit);
      for (const b of stranded) b.requeueCount += 1;
      return stranded.map((b) => ({ id: b.id }));
    }),
    failExhausted: vi.fn(async ({ olderThan, maxRequeues }) => {
      let failed = 0;
      for (const b of blocks) {
        if (
          b.status === ClassQaStatus.PENDING &&
          b.updatedAt < olderThan &&
          b.requeueCount >= maxRequeues
        ) {
          b.status = ClassQaStatus.FAILED;
          failed += 1;
        }
      }
      return failed;
    }),
  };
  const jobs: JobQueuePort = { enqueue: vi.fn() };
  return { qaRepo, jobs };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("makeClassQaSweeper", () => {
  it("re-enqueues a stranded PENDING block older than the cutoff on the boot tick", async () => {
    vi.useFakeTimers();
    const stranded = block();
    const { qaRepo, jobs } = makeDeps([stranded]);
    const sweeper = makeClassQaSweeper({ qaRepo, jobs });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue).toHaveBeenCalledWith(CLASS_QA_ANSWER_JOB, {
      blockId: 1,
    });
    // The claim burned one requeue.
    expect(stranded.requeueCount).toBe(1);
    sweeper.stop();
  });

  it("leaves a recent PENDING block alone", async () => {
    vi.useFakeTimers();
    const fresh = block({ updatedAt: new Date(Date.now() - 10_000) });
    const { qaRepo, jobs } = makeDeps([fresh]);
    const sweeper = makeClassQaSweeper({ qaRepo, jobs });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(fresh.requeueCount).toBe(0);
    expect(fresh.status).toBe(ClassQaStatus.PENDING);
    sweeper.stop();
  });

  it("marks a stranded block FAILED once it exhausts its requeues", async () => {
    vi.useFakeTimers();
    const exhausted = block({ requeueCount: CLASS_QA_MAX_REQUEUES });
    const { qaRepo, jobs } = makeDeps([exhausted]);
    const sweeper = makeClassQaSweeper({ qaRepo, jobs });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(exhausted.status).toBe(ClassQaStatus.FAILED);
    expect(jobs.enqueue).not.toHaveBeenCalled();
    sweeper.stop();
  });

  it("leaves settled (ANSWERED/FAILED) blocks alone", async () => {
    vi.useFakeTimers();
    const answered = block({ id: 1, status: ClassQaStatus.ANSWERED });
    const failed = block({ id: 2, status: ClassQaStatus.FAILED });
    const { qaRepo, jobs } = makeDeps([answered, failed]);
    const sweeper = makeClassQaSweeper({ qaRepo, jobs });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(answered.status).toBe(ClassQaStatus.ANSWERED);
    expect(failed.status).toBe(ClassQaStatus.FAILED);
    sweeper.stop();
  });

  it("keeps sweeping every minute", async () => {
    vi.useFakeTimers();
    const { qaRepo, jobs } = makeDeps([]);
    const sweeper = makeClassQaSweeper({ qaRepo, jobs });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(qaRepo.claimStranded).toHaveBeenCalledTimes(3);
    sweeper.stop();
  });

  it("does not sweep after stop", async () => {
    vi.useFakeTimers();
    const { qaRepo, jobs } = makeDeps([]);
    const sweeper = makeClassQaSweeper({ qaRepo, jobs });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    sweeper.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(qaRepo.claimStranded).toHaveBeenCalledTimes(1);
  });

  it("tickOnce drains stranded blocks without the interval", async () => {
    const stranded = block();
    const { qaRepo, jobs } = makeDeps([stranded]);
    const sweeper = makeClassQaSweeper({ qaRepo, jobs });

    await sweeper.tickOnce();

    expect(jobs.enqueue).toHaveBeenCalledWith(CLASS_QA_ANSWER_JOB, {
      blockId: stranded.id,
    });
  });
});
