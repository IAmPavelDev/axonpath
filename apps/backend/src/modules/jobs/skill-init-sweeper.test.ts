import { describe, expect, it, vi } from "vitest";
import { makeSkillInitSweeper, INIT_STALE_MS } from "./skill-init-sweeper";
import { SKILL_INIT_JOB } from "@/modules/learning/application/commands/create-skill";
import { SKILL_FIRST_LESSON_JOB } from "@/modules/tutoring/application/generate-first-lesson";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";

const makeDeps = (
  claimed: Array<{
    id: number;
    userId: number;
    prompt: string;
    description: string;
  }> = [],
  settled: number[] = [],
  accepted: Array<{ id: number; userId: number }> = [],
) => {
  const claimStaleInit = vi.fn(async (_olderThan: Date) => claimed);
  const claimStaleFirstLesson = vi.fn(
    async (_olderThan: Date) => accepted,
  );
  const settleStaleGenerating = vi.fn(async (_olderThan: Date) => settled);
  const skillRepo: Pick<
    SkillRepository,
    "claimStaleInit" | "claimStaleFirstLesson" | "settleStaleGenerating"
  > = {
    claimStaleInit,
    claimStaleFirstLesson,
    settleStaleGenerating,
  };
  const enqueued: { jobName: string; payload: unknown }[] = [];
  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };
  return {
    sweeper: makeSkillInitSweeper({ skillRepo, jobs }),
    claimStaleInit,
    claimStaleFirstLesson,
    settleStaleGenerating,
    enqueued,
  };
};

describe("skillInitSweeper", () => {
  it("re-enqueues stage 1 (init with the stored prompt) for a stuck skill with no description", async () => {
    const { sweeper, claimStaleInit, enqueued } = makeDeps([
      { id: 9, userId: 7, prompt: "learn joins", description: "" },
    ]);

    await sweeper.tickOnce();

    expect(claimStaleInit).toHaveBeenCalledWith(expect.any(Date));
    const cutoff = claimStaleInit.mock.calls[0]?.[0];
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(INIT_STALE_MS);
    expect(enqueued).toEqual([
      {
        jobName: SKILL_INIT_JOB,
        payload: { skillId: 9, userId: 7, prompt: "learn joins" },
      },
    ]);
  });

  it("re-enqueues stage 2 (first lesson) for a stuck skill whose description already landed", async () => {
    const { sweeper, enqueued } = makeDeps([
      { id: 9, userId: 7, prompt: "learn joins", description: "Join primer." },
    ]);

    await sweeper.tickOnce();

    expect(enqueued).toEqual([
      { jobName: SKILL_FIRST_LESSON_JOB, payload: { skillId: 9, userId: 7 } },
    ]);
  });

  it("heals an abandoned review (ACTIVE, lesson-less) as accepted and arms stage 2", async () => {
    const { sweeper, claimStaleFirstLesson, enqueued } = makeDeps(
      [],
      [],
      [{ id: 11, userId: 7 }],
    );

    await sweeper.tickOnce();

    expect(claimStaleFirstLesson).toHaveBeenCalledWith(expect.any(Date));
    const cutoff = claimStaleFirstLesson.mock.calls[0]?.[0];
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(INIT_STALE_MS);
    expect(enqueued).toEqual([
      { jobName: SKILL_FIRST_LESSON_JOB, payload: { skillId: 11, userId: 7 } },
    ]);
  });

  it("enqueues nothing when no skill is stuck", async () => {
    const { sweeper, enqueued } = makeDeps();

    await sweeper.tickOnce();

    expect(enqueued).toEqual([]);
  });

  it("survives a repo failure instead of crashing the tick", async () => {
    const { sweeper, claimStaleInit } = makeDeps();
    claimStaleInit.mockRejectedValueOnce(new Error("db down"));

    await expect(sweeper.tickOnce()).resolves.toBeUndefined();
  });

  it("settles abandoned GENERATING skills (class exists, no marker) ACTIVE", async () => {
    const { sweeper, settleStaleGenerating } = makeDeps([], [13]);

    await sweeper.tickOnce();

    expect(settleStaleGenerating).toHaveBeenCalledWith(expect.any(Date));
  });

  it("survives a settle failure instead of crashing the tick", async () => {
    const { sweeper, settleStaleGenerating } = makeDeps();
    settleStaleGenerating.mockRejectedValueOnce(new Error("db down"));

    await expect(sweeper.tickOnce()).resolves.toBeUndefined();
  });
});
