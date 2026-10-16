import { describe, expect, it, vi } from "vitest";
import { makeSkillInitSweeper, INIT_STALE_MS } from "./skill-init-sweeper";
import { SKILL_INIT_JOB } from "@/modules/learning/application/commands/create-skill";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";

const makeDeps = (
  claimed: Array<{ id: number; userId: number; topic: string }>,
  settled: number[] = [],
) => {
  const claimStaleInit = vi.fn(async (_olderThan: Date) => claimed);
  const settleStaleGenerating = vi.fn(async (_olderThan: Date) => settled);
  const enqueued: { jobName: string; payload: unknown }[] = [];
  const skillRepo: Pick<SkillRepository, "claimStaleInit" | "settleStaleGenerating"> = {
    claimStaleInit,
    settleStaleGenerating,
  };
  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };
  return {
    sweeper: makeSkillInitSweeper({ skillRepo, jobs }),
    claimStaleInit,
    settleStaleGenerating,
    enqueued,
  };
};

describe("skillInitSweeper", () => {
  it("re-enqueues skill-init for every claimed stuck skill", async () => {
    const { sweeper, claimStaleInit, enqueued } = makeDeps([
      { id: 41, userId: 7, topic: "SQL" },
      { id: 42, userId: 8, topic: "Joins" },
    ]);

    await sweeper.tickOnce();

    expect(claimStaleInit).toHaveBeenCalledWith(expect.any(Date));
    const cutoff = claimStaleInit.mock.calls[0][0];
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(INIT_STALE_MS);
    expect(enqueued).toEqual([
      {
        jobName: SKILL_INIT_JOB,
        payload: { skillId: 41, userId: 7, topic: "SQL" },
      },
      {
        jobName: SKILL_INIT_JOB,
        payload: { skillId: 42, userId: 8, topic: "Joins" },
      },
    ]);
  });

  it("enqueues nothing when no skill is stuck", async () => {
    const { sweeper, enqueued } = makeDeps([]);

    await sweeper.tickOnce();

    expect(enqueued).toEqual([]);
  });

  it("survives a repo failure instead of crashing the tick", async () => {
    const skillRepo: Pick<SkillRepository, "claimStaleInit" | "settleStaleGenerating"> = {
      claimStaleInit: async () => {
        throw new Error("neon hiccup");
      },
      settleStaleGenerating: async () => [],
    };
    const enqueued: { jobName: string; payload: unknown }[] = [];
    const sweeper = makeSkillInitSweeper({
      skillRepo,
      jobs: {
        enqueue: (jobName, payload) => void enqueued.push({ jobName, payload }),
      },
    });

    await expect(sweeper.tickOnce()).resolves.toBeUndefined();
    expect(enqueued).toEqual([]);
  });

  it("settles abandoned GENERATING skills (class exists, no marker) ACTIVE", async () => {
    const { sweeper, settleStaleGenerating } = makeDeps([], [22]);

    await sweeper.tickOnce();

    expect(settleStaleGenerating).toHaveBeenCalledWith(expect.any(Date));
    const cutoff = settleStaleGenerating.mock.calls[0][0];
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(INIT_STALE_MS);
  });

  it("survives a settle failure instead of crashing the tick", async () => {
    const skillRepo: Pick<SkillRepository, "claimStaleInit" | "settleStaleGenerating"> = {
      claimStaleInit: async () => [],
      settleStaleGenerating: async () => {
        throw new Error("neon hiccup");
      },
    };
    const sweeper = makeSkillInitSweeper({ skillRepo, jobs: { enqueue: () => undefined } });

    await expect(sweeper.tickOnce()).resolves.toBeUndefined();
  });
});
