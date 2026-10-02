import { describe, expect, it } from "vitest";
import { makeCreateSkill, SKILL_INIT_JOB } from "./create-skill";
import { SkillMode, SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { ok } from "@/modules/platform/result";

/** Test seam: in-memory skill repo + job queue capturing creation and enqueue. */
const makeFakeDeps = () => {
  const createInputs: unknown[] = [];
  const enqueued: { jobName: string; payload: unknown }[] = [];

  const skillRepo: SkillRepository = {
    create: async (input) => {
      createInputs.push(input);
      return { id: 42, status: input.status };
    },
    update: async () => {
      throw new Error("not used in create tests");
    },
    findById: async () => {
      throw new Error("not used in create tests");
    },
    listByUser: async () => {
      throw new Error("not used in create tests");
    },
    listByStatus: async () => {
      throw new Error("not used in create tests");
    },
  };

  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };

  return { deps: { skillRepo, jobs }, createInputs, enqueued };
};

describe("makeCreateSkill", () => {
  it("creates the shell in GENERATING and enqueues skill-init", async () => {
    const { deps, createInputs, enqueued } = makeFakeDeps();
    const createSkill = makeCreateSkill(deps);

    const result = await createSkill({
      userId: 1,
      topic: "SQL joins",
      mode: SkillMode.AUTOMATIC,
    });

    expect(result).toEqual(ok({ id: 42, status: SkillStatus.GENERATING }));
    expect(createInputs).toEqual([
      {
        userId: 1,
        topic: "SQL joins",
        status: SkillStatus.GENERATING,
        mode: SkillMode.AUTOMATIC,
      },
    ]);
    expect(enqueued).toEqual([
      {
        jobName: SKILL_INIT_JOB,
        payload: { skillId: 42, userId: 1, topic: "SQL joins" },
      },
    ]);
  });
});
