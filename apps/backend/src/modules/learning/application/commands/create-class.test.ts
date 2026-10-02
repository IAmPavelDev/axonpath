import { describe, expect, it } from "vitest";
import {
  NextClassOptionsState,
  SkillMode,
  SkillStatus,
} from "@/prisma/generated";
import { makeCreateClass } from "./create-class";

type SkillFake = {
  id: number;
  userId: number;
  topic: string;
  description: string;
  status: SkillStatus;
  mode: SkillMode;
  optionsState: NextClassOptionsState;
  optionsStateAt: Date | null;
};

const SKILL: SkillFake = {
  id: 10,
  userId: 7,
  topic: "SQL joins",
  description: "",
  status: SkillStatus.ACTIVE,
  mode: SkillMode.MANUAL,
  optionsState: NextClassOptionsState.READY,
  optionsStateAt: new Date(),
};

const makeDeps = (skill: SkillFake | null = SKILL) => {
  const state = {
    updates: [] as { id: number; patch: Record<string, unknown> }[],
    cleared: [] as number[],
    enqueued: [] as { jobName: string; payload: unknown }[],
    durableEnqueued: [] as { skillId: number; userId: number; target?: string }[],
  };

  const deps = {
    skillRepo: {
      create: async () => {
        throw new Error("create not used in create-class tests");
      },
      update: async (id: number, patch: Record<string, unknown>) => {
        state.updates.push({ id, patch });
        return {
          id,
          topic: SKILL.topic,
          description: "",
          status: (patch.status as SkillStatus) ?? SKILL.status,
          mode: (patch.mode as SkillMode) ?? SKILL.mode,
          optionsState:
            (patch.optionsState as NextClassOptionsState) ?? SKILL.optionsState,
          optionsStateAt: (patch.optionsStateAt as Date | null) ?? null,
        };
      },
      findById: async () => skill,
      listByUser: async () => [],
      listByStatus: async () => [],
    },
    optionRepo: {
      replaceForSkill: async () => {
        throw new Error("replaceForSkill not used in create-class tests");
      },
      clearForSkill: async (skillId: number) => {
        state.cleared.push(skillId);
      },
      listBySkill: async () => [],
    },
    jobs: {
      enqueue: (jobName: string, payload: unknown) => {
        state.enqueued.push({ jobName, payload });
      },
    },
    nextClassJobs: {
      enqueue: async (input: { skillId: number; userId: number; target?: string }) => {
        state.durableEnqueued.push(input);
      },
      claim: async () => {
        throw new Error("claim not used in create-class tests");
      },
      claimOne: async () => null,
      release: async () => {},
      requeue: async () => {},
      existsPending: async () => false,
    },
  };
  return { deps, state };
};

describe("createClass", () => {
  it("rejects a skill the user does not own or that is missing", async () => {
    const owned = makeDeps();
    expect(
      await makeCreateClass(owned.deps)({
        skillId: 10,
        userId: 999,
        target: "Practice joins",
      }),
    ).toMatchObject({ ok: false, error: { kind: "NotOwned" } });

    const missing = makeDeps(null);
    expect(
      await makeCreateClass(missing.deps)({
        skillId: 10,
        userId: 7,
        target: "Practice joins",
      }),
    ).toMatchObject({ ok: false, error: { kind: "SkillNotFound" } });
  });

  it("rejects non-manual skills and non-ACTIVE skills", async () => {
    for (const skill of [
      { ...SKILL, mode: SkillMode.AUTOMATIC },
      { ...SKILL, status: SkillStatus.PAUSED },
      { ...SKILL, status: SkillStatus.GENERATING },
    ]) {
      const { deps } = makeDeps(skill);
      const result = await makeCreateClass(deps)({
        skillId: 10,
        userId: 7,
        target: "Practice joins",
      });
      expect(result).toMatchObject({
        ok: false,
        error: { kind: "ClassCreationNotAllowed" },
      });
    }
  });

  it("consumes options, enters GENERATING, and carries the target durably", async () => {
    const { deps, state } = makeDeps();
    const result = await makeCreateClass(deps)({
      skillId: 10,
      userId: 7,
      target: "Practice LEFT JOIN with real datasets",
    });

    expect(result).toMatchObject({ ok: true, value: { status: SkillStatus.GENERATING } });
    expect(state.cleared).toEqual([10]);
    expect(state.updates).toContainEqual({
      id: 10,
      patch: {
        status: SkillStatus.GENERATING,
        optionsState: NextClassOptionsState.NONE,
        optionsStateAt: null,
      },
    });
    expect(state.durableEnqueued).toEqual([
      {
        skillId: 10,
        userId: 7,
        target: "Practice LEFT JOIN with real datasets",
      },
    ]);
    expect(state.enqueued).toEqual([
      {
        jobName: "skill-next-class",
        payload: {
          skillId: 10,
          userId: 7,
          target: "Practice LEFT JOIN with real datasets",
        },
      },
    ]);
  });
});
