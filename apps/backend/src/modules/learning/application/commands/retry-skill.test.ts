import { describe, expect, it } from "vitest";
import { makeRetrySkill, type RetrySkillDeps } from "./retry-skill";
import { SKILL_INIT_JOB } from "./create-skill";
import { SKILL_FIRST_LESSON_JOB } from "@/modules/tutoring/application/generate-first-lesson";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { ok } from "@/modules/platform/result";

/** Test seam: in-memory skill repo + job queue capturing update and enqueue. */
const makeFakeDeps = (
  skill: {
    userId: number;
    topic: string;
    prompt: string;
    description: string;
    status: string;
  } | null,
) => {
  const updates: { id: number; patch: Record<string, unknown> }[] = [];
  const enqueued: { jobName: string; payload: unknown }[] = [];

  const skillRepo: SkillRepository = {
    create: async () => {
      throw new Error("not used in retry tests");
    },
    update: async (id, patch) => {
      updates.push({ id, patch: { ...patch } });
      return {
        id,
        topic: "SQL joins",
        description: "Learn SQL joins by doing.",
        status: "GENERATING",
      };
    },
    findById: async () =>
      skill
        ? {
            id: 42,
            topic: skill.topic,
            prompt: skill.prompt,
            description: skill.description,
            status: skill.status,
            userId: skill.userId,
          }
        : null,
    listByUser: async () => {
      throw new Error("not used in retry tests");
    },
    listByStatus: async () => {
      throw new Error("not used in retry tests");
    },
    settleStaleGenerating: async () => [],
    claimStaleInit: async () => {
      throw new Error("not used in retry tests");
    },
    claimStaleFirstLesson: async () => {
      throw new Error("not used in retry tests");
    },
    delete: async () => {
      throw new Error("not used in retry tests");
    },
  };

  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };

  const deps: RetrySkillDeps = { skillRepo, jobs };
  return { deps, updates, enqueued };
};

describe("makeRetrySkill", () => {
  const input = { skillId: 42, userId: 7 };

  it("re-enqueues stage 1 (skill-init with the stored prompt) when no description landed", async () => {
    const { deps, updates, enqueued } = makeFakeDeps({
      userId: 7,
      topic: "I want to learn SQL joins for work",
      prompt: "I want to learn SQL joins for work — I know basic SELECTs.",
      description: "",
      status: SkillStatus.FAILED,
    });

    const result = await makeRetrySkill(deps)(input);

    expect(result).toEqual(ok({ status: "GENERATING" }));
    expect(updates).toEqual([
      { id: 42, patch: { status: SkillStatus.GENERATING } },
    ]);
    expect(enqueued).toEqual([
      {
        jobName: SKILL_INIT_JOB,
        payload: {
          skillId: 42,
          userId: 7,
          prompt: "I want to learn SQL joins for work — I know basic SELECTs.",
        },
      },
    ]);
  });

  it("re-enqueues stage 2 (first lesson) when the draft already landed", async () => {
    const { deps, updates, enqueued } = makeFakeDeps({
      userId: 7,
      topic: "SQL Joins",
      prompt: "I want to learn SQL joins for work — I know basic SELECTs.",
      description: "Learn SQL joins by doing.",
      status: SkillStatus.FAILED,
    });

    const result = await makeRetrySkill(deps)(input);

    expect(result).toEqual(ok({ status: "GENERATING" }));
    expect(updates).toEqual([
      { id: 42, patch: { status: SkillStatus.GENERATING } },
    ]);
    expect(enqueued).toEqual([
      { jobName: SKILL_FIRST_LESSON_JOB, payload: { skillId: 42, userId: 7 } },
    ]);
  });

  it("rejects a skill the user does not own", async () => {
    const { deps, updates, enqueued } = makeFakeDeps({
      userId: 999,
      topic: "SQL joins",
      prompt: "p",
      description: "d",
      status: SkillStatus.FAILED,
    });

    const result = await makeRetrySkill(deps)(input);

    expect(result).toEqual({
      ok: false,
      error: { kind: "NotOwned", skillId: 42 },
    });
    expect(updates).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("rejects the transition from ACTIVE", async () => {
    const { deps, updates, enqueued } = makeFakeDeps({
      userId: 7,
      topic: "SQL joins",
      prompt: "p",
      description: "d",
      status: SkillStatus.ACTIVE,
    });

    const result = await makeRetrySkill(deps)(input);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "InvalidSkillTransition",
        from: SkillStatus.ACTIVE,
        to: SkillStatus.GENERATING,
      },
    });
    expect(updates).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("rejects the transition from GENERATING", async () => {
    const { deps, enqueued } = makeFakeDeps({
      userId: 7,
      topic: "SQL joins",
      prompt: "p",
      description: "d",
      status: SkillStatus.GENERATING,
    });

    const result = await makeRetrySkill(deps)(input);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "InvalidSkillTransition",
        from: SkillStatus.GENERATING,
        to: SkillStatus.GENERATING,
      },
    });
    expect(enqueued).toHaveLength(0);
  });

  it("reports SkillNotFound when the skill does not exist", async () => {
    const { deps, enqueued } = makeFakeDeps(null);

    const result = await makeRetrySkill(deps)(input);

    expect(result).toEqual({
      ok: false,
      error: { kind: "SkillNotFound", skillId: 42 },
    });
    expect(enqueued).toHaveLength(0);
  });
});
