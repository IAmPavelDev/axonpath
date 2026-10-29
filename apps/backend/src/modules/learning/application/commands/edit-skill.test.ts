import { describe, expect, it } from "vitest";
import { makeEditSkill, type EditSkillDeps } from "./edit-skill";
import { SKILL_FIRST_LESSON_JOB } from "@/modules/tutoring/application/generate-first-lesson";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { ok } from "@/modules/platform/result";

/** Test seam: in-memory skill/class repos + job queue capturing the
 * acceptance trigger. */
const makeFakeDeps = (skill: {
  id: number;
  userId: number;
  topic: string;
  prompt: string;
  description: string;
  status: string;
} | null) => {
  const updates: { id: number; patch: Record<string, unknown> }[] = [];
  const enqueued: { jobName: string; payload: unknown }[] = [];
  const drains: number[] = [];
  const classCount: Record<number, number> = {};

  const skillRepo: SkillRepository = {
    create: async () => {
      throw new Error("not used in edit tests");
    },
    update: async (id, patch) => {
      updates.push({ id, patch: { ...patch } });
      if (!skill) {
        throw new Error("skill not seeded in edit tests");
      }
      const merged = { ...skill, ...patch };
      return {
        id,
        topic: merged.topic,
        description: merged.description,
        status: merged.status,
      };
    },
    findById: async () => skill,
    listByUser: async () => {
      throw new Error("not used in edit tests");
    },
    listByStatus: async () => {
      throw new Error("not used in edit tests");
    },
    settleStaleGenerating: async () => [],
    claimStaleInit: async () => {
      throw new Error("not used in edit tests");
    },
    claimStaleFirstLesson: async () => {
      throw new Error("not used in edit tests");
    },
    claimFirstLessonRun: async () => null,
    delete: async () => {
      throw new Error("not used in edit tests");
    },
  };

  const classRepo = {
    findTopBySkill: async (skillId: number) =>
      (classCount[skillId] ?? 0) > 0
        ? { id: 7, index: 0, title: "Existing lesson" }
        : null,
  } as ClassRepository;

  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };

  const deps: EditSkillDeps = {
    skillRepo,
    classRepo,
    jobs,
    awaitDrain: async () => {
      drains.push(1);
    },
  };
  return { deps, updates, enqueued, drains, classCount };
};

const SKILL = {
  id: 42,
  userId: 7,
  topic: "SQL Joins",
  prompt: "I want to learn SQL joins for work.",
  description: "Learn SQL joins by doing.",
  status: SkillStatus.ACTIVE,
};

describe("makeEditSkill", () => {
  const input = {
    id: 42,
    userId: 7,
    topic: "SQL Joins From Zero",
    description: "An edited goal.",
  };

  it("treats an edit of a lesson-less ACTIVE skill as acceptance: saves fields, flips GENERATING, arms the first lesson", async () => {
    const { deps, updates, enqueued } = makeFakeDeps(SKILL);

    const result = await makeEditSkill(deps)(input);

    expect(result).toEqual(
      ok({
        id: 42,
        topic: "SQL Joins From Zero",
        description: "An edited goal.",
        status: "GENERATING",
      }),
    );
    expect(updates).toEqual([
      {
        id: 42,
        patch: {
          topic: "SQL Joins From Zero",
          description: "An edited goal.",
          status: SkillStatus.GENERATING,
        },
      },
    ]);
    expect(enqueued).toEqual([
      { jobName: SKILL_FIRST_LESSON_JOB, payload: { skillId: 42, userId: 7 } },
    ]);
  });

  it("drains the job queue on acceptance so the armed lesson runs in-request", async () => {
    const { deps, drains } = makeFakeDeps(SKILL);

    await makeEditSkill(deps)(input);

    expect(drains).toHaveLength(1);
  });

  it("updates an ACTIVE skill that already has lessons without arming generation", async () => {
    const { deps, updates, enqueued, drains, classCount } = makeFakeDeps(SKILL);
    classCount[42] = 2;

    const result = await makeEditSkill(deps)(input);

    expect(result).toEqual(
      ok({
        id: 42,
        topic: "SQL Joins From Zero",
        description: "An edited goal.",
        status: SkillStatus.ACTIVE,
      }),
    );
    expect(updates).toEqual([
      {
        id: 42,
        patch: { topic: "SQL Joins From Zero", description: "An edited goal." },
      },
    ]);
    expect(enqueued).toHaveLength(0);
    expect(drains).toHaveLength(0);
  });

  it("does not arm generation from GENERATING (a stage is already in flight)", async () => {
    const { deps, enqueued } = makeFakeDeps({
      ...SKILL,
      status: SkillStatus.GENERATING,
    });

    await makeEditSkill(deps)(input);

    expect(enqueued).toHaveLength(0);
  });

  it("returns the current fields on an empty patch", async () => {
    const { deps, updates, enqueued } = makeFakeDeps(SKILL);

    const result = await makeEditSkill(deps)({ id: 42, userId: 7 });

    expect(result).toEqual(
      ok({
        id: 42,
        topic: SKILL.topic,
        description: SKILL.description,
        status: SkillStatus.ACTIVE,
      }),
    );
    expect(updates).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("rejects a skill the user does not own", async () => {
    const { deps, updates, enqueued } = makeFakeDeps(SKILL);

    const result = await makeEditSkill(deps)({ ...input, userId: 999 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "NotOwned", skillId: 42 },
    });
    expect(updates).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("reports SkillNotFound when the skill does not exist", async () => {
    const { deps, enqueued } = makeFakeDeps(null);

    const result = await makeEditSkill(deps)(input);

    expect(result).toEqual({
      ok: false,
      error: { kind: "SkillNotFound", skillId: 42 },
    });
    expect(enqueued).toHaveLength(0);
  });
});
