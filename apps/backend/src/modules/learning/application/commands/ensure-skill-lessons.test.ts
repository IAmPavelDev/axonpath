import { describe, expect, it } from "vitest";
import {
  makeEnsureSkillLessons,
  type EnsureSkillLessonsDeps,
} from "./ensure-skill-lessons";
import { SKILL_FIRST_LESSON_JOB } from "@/modules/tutoring/application/generate-first-lesson";
import { SkillStatus } from "@/prisma/generated";
import { err, ok } from "@/modules/platform/result";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";

const SKILL = {
  id: 42,
  userId: 7,
  topic: "SQL Joins",
  prompt: "I want to learn SQL joins for work.",
  description: "Learn SQL joins by doing.",
  status: SkillStatus.ACTIVE,
};
/** Widened row shape — SKILL's ACTIVE literal must not narrow the options. */
type SkillRow = {
  id: number;
  userId: number;
  topic: string;
  prompt: string;
  description: string;
  status: string;
};

/** Test seam: skill row + class presence + claim outcome + drain recorder. */
const makeDeps = (options: {
  skill?: SkillRow | null;
  hasClass?: boolean;
  claimReturns?: { id: number; userId: number } | null;
  postDrainSkill?: SkillRow | null;
}): { deps: EnsureSkillLessonsDeps; drained: number[]; enqueued: { jobName: string; payload: unknown }[] } => {
  const enqueued: { jobName: string; payload: unknown }[] = [];
  const drained: number[] = [];
  const skill = options.skill === undefined ? SKILL : options.skill;
  const skillRepo = {
    findById: async () => {
      if (skill === null) return null;
      return options.postDrainSkill === undefined
        ? skill
        : options.postDrainSkill;
    },
    claimFirstLessonRun: async () =>
      options.claimReturns === undefined
        ? { id: skill?.id ?? 42, userId: skill?.userId ?? 7 }
        : options.claimReturns,
  };

  const classRepo = {
    findTopBySkill: async () =>
      options.hasClass ? { id: 7, index: 0, title: "Existing lesson" } : null,
  };

  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };

  const deps: EnsureSkillLessonsDeps = {
    skillRepo,
    classRepo,
    jobs,
    awaitDrain: async () => {
      drained.push(1);
    },
  };
  return { deps, drained, enqueued };
};

const input = { skillId: 42, userId: 7 };

describe("makeEnsureSkillLessons", () => {
  it("claims a lesson-less ACTIVE skill, arms the first lesson and drains in-request", async () => {
    const { deps, drained, enqueued } = makeDeps({
      postDrainSkill: { ...SKILL, status: SkillStatus.GENERATING },
    });

    const result = await makeEnsureSkillLessons(deps)(input);

    expect(result).toEqual(ok({ status: SkillStatus.GENERATING }));
    expect(enqueued).toEqual([
      { jobName: SKILL_FIRST_LESSON_JOB, payload: { skillId: 42, userId: 7 } },
    ]);
    expect(drained).toHaveLength(1);
  });

  it("reports the post-drain status — a drained run usually settles ACTIVE", async () => {
    const { deps } = makeDeps({
      postDrainSkill: { ...SKILL, status: SkillStatus.ACTIVE },
    });

    const result = await makeEnsureSkillLessons(deps)(input);

    expect(result).toEqual(ok({ status: SkillStatus.ACTIVE }));
  });

  it("is a no-op when lessons already exist", async () => {
    const { deps, drained, enqueued } = makeDeps({ hasClass: true });

    const result = await makeEnsureSkillLessons(deps)(input);

    expect(result).toEqual(ok({ status: SKILL.status }));
    expect(enqueued).toHaveLength(0);
    expect(drained).toHaveLength(0);
  });

  it("reports FAILED without re-arming — retry is the client's explicit choice", async () => {
    const { deps, drained, enqueued } = makeDeps({
      skill: { ...SKILL, status: SkillStatus.FAILED },
    });

    const result = await makeEnsureSkillLessons(deps)(input);

    expect(result).toEqual(ok({ status: SkillStatus.FAILED }));
    expect(enqueued).toHaveLength(0);
    expect(drained).toHaveLength(0);
  });

  it("keeps hands off a fresh GENERATING skill (a run is plausibly in flight)", async () => {
    const { deps, drained, enqueued } = makeDeps({
      skill: { ...SKILL, status: SkillStatus.GENERATING },
      claimReturns: null,
    });

    const result = await makeEnsureSkillLessons(deps)(input);

    expect(result).toEqual(ok({ status: SkillStatus.GENERATING }));
    expect(enqueued).toHaveLength(0);
    expect(drained).toHaveLength(0);
  });

  it("re-arms a stale GENERATING skill whose arming job was lost", async () => {
    const { deps, drained, enqueued } = makeDeps({
      skill: { ...SKILL, status: SkillStatus.GENERATING },
      claimReturns: { id: 42, userId: 7 },
    });

    const result = await makeEnsureSkillLessons(deps)(input);

    expect(result).toEqual(ok({ status: SkillStatus.GENERATING }));
    expect(enqueued).toEqual([
      { jobName: SKILL_FIRST_LESSON_JOB, payload: { skillId: 42, userId: 7 } },
    ]);
    expect(drained).toHaveLength(1);
  });

  it("rejects a skill the user does not own", async () => {
    const { deps } = makeDeps({});

    const result = await makeEnsureSkillLessons(deps)({
      skillId: 42,
      userId: 8,
    });

    expect(result).toEqual(err({ kind: "NotOwned", skillId: 42 }));
  });

  it("reports SkillNotFound when the skill does not exist", async () => {
    const { deps } = makeDeps({ skill: null });

    const result = await makeEnsureSkillLessons(deps)(input);

    expect(result).toEqual(err({ kind: "SkillNotFound", skillId: 42 }));
  });
});
