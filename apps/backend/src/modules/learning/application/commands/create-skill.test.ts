import { describe, expect, it } from "vitest";
import { makeCreateSkill, SKILL_INIT_JOB } from "./create-skill";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { ok } from "@/modules/platform/result";

const PROMPT = "I want to learn SQL joins for work — I know basic SELECTs.";
const makeFakeDeps = () => {

/** Test seam: in-memory skill repo + job queue capturing creation and enqueue. */
  const createInputs: Parameters<SkillRepository["create"]>[0][] = [];
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
    settleStaleGenerating: async () => [],
    claimStaleInit: async () => {
      throw new Error("not used in create tests");
    },
    claimStaleFirstLesson: async () => {
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
  it("creates the shell in GENERATING with the prompt and enqueues skill-init", async () => {
    const { deps, createInputs, enqueued } = makeFakeDeps();
    const createSkill = makeCreateSkill(deps);

    const result = await createSkill({ userId: 1, prompt: PROMPT });

    expect(result).toEqual(ok({ id: 42, status: SkillStatus.GENERATING }));
    expect(createInputs).toEqual([
      {
        userId: 1,
        prompt: PROMPT,
        topic: PROMPT.slice(0, 255),
        status: SkillStatus.GENERATING,
      },
    ]);
    expect(enqueued).toEqual([
      {
        jobName: SKILL_INIT_JOB,
        payload: { skillId: 42, userId: 1, prompt: PROMPT },
      },
    ]);
  });

  it("clips the placeholder topic to the topic column width", async () => {
    const { deps, createInputs } = makeFakeDeps();
    const createSkill = makeCreateSkill(deps);

    await createSkill({ userId: 1, prompt: "x".repeat(400) });

    expect(createInputs[0]?.topic).toHaveLength(255);
  });
});
