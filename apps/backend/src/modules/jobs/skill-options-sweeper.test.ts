import { describe, expect, it, vi } from "vitest";
import {
  makeSkillOptionsSweeper,
  OPTIONS_STALE_MS,
} from "./skill-options-sweeper";
import { SKILL_CLASS_OPTIONS_JOB } from "@/modules/tutoring/application/generate-class-options";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";

const makeDeps = (stale: Array<{ id: number; userId: number }>) => {
  const listStalePendingOptions = vi.fn(async (_olderThan: Date) => stale);
  const enqueued: { jobName: string; payload: unknown }[] = [];
  const skillRepo: Pick<SkillRepository, "listStalePendingOptions"> = {
    listStalePendingOptions,
  };
  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };
  return {
    sweeper: makeSkillOptionsSweeper({ skillRepo, jobs }),
    listStalePendingOptions,
    enqueued,
  };
};

describe("skillOptionsSweeper", () => {
  it("re-enqueues class-options for every stale PENDING skill", async () => {
    const { sweeper, listStalePendingOptions, enqueued } = makeDeps([
      { id: 9, userId: 7 },
    ]);

    await sweeper.tickOnce();

    const cutoff = listStalePendingOptions.mock.calls[0][0];
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(
      OPTIONS_STALE_MS,
    );
    expect(enqueued).toEqual([
      { jobName: SKILL_CLASS_OPTIONS_JOB, payload: { skillId: 9, userId: 7 } },
    ]);
  });

  it("enqueues nothing when no options job was lost", async () => {
    const { sweeper, enqueued } = makeDeps([]);

    await sweeper.tickOnce();

    expect(enqueued).toEqual([]);
  });
});
