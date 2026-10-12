import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { makeSetImmediateJobQueue } from "@/modules/platform/infrastructure/set-immediate-jobs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSetImmediateJobQueue idle drain", () => {
  it("resolves immediately when nothing is pending", async () => {
    const queue = makeSetImmediateJobQueue({});

    await expect(queue.idle()).resolves.toBeUndefined();
  });

  it("waits for a job and its follow-up enqueues before resolving", async () => {
    const ran: string[] = [];
    const { promise: gated, resolve: release } = Promise.withResolvers<void>();
    const queue = makeSetImmediateJobQueue({
      // The parent enqueues a child mid-run — the exact cascade the QA
      // pipeline produces (answer → miners). idle() must not resolve while
      // the child (held open here) is still in flight.
      parent: async () => {
        ran.push("parent:start");
        queue.enqueue("child", {});
        ran.push("parent:end");
      },
      child: async () => {
        ran.push("child:start");
        await gated;
        ran.push("child:end");
      },
    });

    queue.enqueue("parent", {});
    let drained = false;
    const drain = queue.idle().then(() => {
      drained = true;
    });

    await vi.waitFor(() => expect(ran).toContain("child:start"));
    expect(drained).toBe(false);

    release();
    await drain;
    expect(ran).toEqual([
      "parent:start",
      "parent:end",
      "child:start",
      "child:end",
    ]);
    await queue.idle();
  });

  it("drains even when a job fails (failure is logged, never propagated)", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const queue = makeSetImmediateJobQueue({
      boom: async () => {
        throw new Error("boom");
      },
    });

    queue.enqueue("boom", {});

    await queue.idle();
    expect(errorSpy).toHaveBeenCalled();
  });
});
