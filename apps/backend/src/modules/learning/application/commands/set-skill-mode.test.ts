import { describe, expect, it } from "vitest";
import {
  NextClassOptionsState,
  SkillMode,
  SkillStatus,
} from "@/prisma/generated";
import { makeSetSkillMode } from "./set-skill-mode";

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
  mode: SkillMode.AUTOMATIC,
  optionsState: NextClassOptionsState.NONE,
  optionsStateAt: null,
};

const makeDeps = (skill: SkillFake | null = SKILL) => {
  const state = {
    updates: [] as { id: number; patch: Record<string, unknown> }[],
    cleared: [] as number[],
    enqueued: [] as { jobName: string; payload: unknown }[],
    durableEnqueued: [] as {
      skillId: number;
      userId: number;
      target?: string;
    }[],
  };

  const deps = {
    skillRepo: {
      create: async () => {
        throw new Error("create not used in set-mode tests");
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
      claimStaleInit: async () => [],
      listStalePendingOptions: async () => [],
    },
    optionRepo: {
      replaceForSkill: async () => {
        throw new Error("replaceForSkill not used in set-mode tests");
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
      enqueue: async (input: {
        skillId: number;
        userId: number;
        target?: string;
      }) => {
        state.durableEnqueued.push(input);
      },
      claim: async () => {
        throw new Error("claim not used in set-mode tests");
      },
      claimOne: async () => null,
      release: async () => {},
      requeue: async () => {},
      existsPending: async () => false,
    },
  };
  return { deps, state };
};

describe("setSkillMode", () => {
  it("rejects a skill the user does not own", async () => {
    const { deps } = makeDeps();
    const result = await makeSetSkillMode(deps)({
      skillId: 10,
      userId: 999,
      mode: SkillMode.MANUAL,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "NotOwned" } });
  });

  it("rejects the switch mid-generation and on failed skills", async () => {
    for (const status of [SkillStatus.GENERATING, SkillStatus.FAILED]) {
      const { deps } = makeDeps({ ...SKILL, status });
      const result = await makeSetSkillMode(deps)({
        skillId: 10,
        userId: 7,
        mode: SkillMode.MANUAL,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { kind: "SkillModeChangeNotAllowed" },
      });
    }
  });

  it("no-ops when the mode is unchanged", async () => {
    const { deps, state } = makeDeps();
    const result = await makeSetSkillMode(deps)({
      skillId: 10,
      userId: 7,
      mode: SkillMode.AUTOMATIC,
    });
    expect(result.ok).toBe(true);
    expect(state.updates).toEqual([]);
    expect(state.enqueued).toEqual([]);
  });

  it("arms candidate generation when switching to MANUAL on an ACTIVE skill", async () => {
    const { deps, state } = makeDeps();
    const result = await makeSetSkillMode(deps)({
      skillId: 10,
      userId: 7,
      mode: SkillMode.MANUAL,
    });

    expect(result.ok).toBe(true);
    expect(state.updates).toContainEqual({
      id: 10,
      patch: { mode: SkillMode.MANUAL },
    });
    expect(state.updates).toContainEqual({
      id: 10,
      patch: {
        optionsState: NextClassOptionsState.PENDING,
        optionsStateAt: expect.any(Date),
      },
    });
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0].jobName).toBe("skill-class-options");
  });

  it("switches to MANUAL on a PAUSED skill without arming options", async () => {
    const { deps, state } = makeDeps({ ...SKILL, status: SkillStatus.PAUSED });
    const result = await makeSetSkillMode(deps)({
      skillId: 10,
      userId: 7,
      mode: SkillMode.MANUAL,
    });

    expect(result.ok).toBe(true);
    expect(state.enqueued).toEqual([]);
    expect(state.updates.some((update) => "optionsState" in update.patch)).toBe(
      false,
    );
  });

  it("consumes options and hands an ACTIVE skill to the pipeline when switching to AUTO", async () => {
    const manual: SkillFake = {
      ...SKILL,
      mode: SkillMode.MANUAL,
      optionsState: NextClassOptionsState.READY,
      optionsStateAt: new Date(),
    };
    const { deps, state } = makeDeps(manual);
    const result = await makeSetSkillMode(deps)({
      skillId: 10,
      userId: 7,
      mode: SkillMode.AUTOMATIC,
    });

    expect(result.ok).toBe(true);
    expect(state.cleared).toEqual([10]);
    expect(state.updates).toContainEqual({
      id: 10,
      patch: { optionsState: NextClassOptionsState.NONE, optionsStateAt: null },
    });
    expect(state.durableEnqueued).toEqual([
      { skillId: 10, userId: 7, target: undefined },
    ]);
    expect(state.enqueued).toEqual([
      { jobName: "skill-next-class", payload: { skillId: 10, userId: 7 } },
    ]);
  });

  it("does not enqueue next-class when switching to AUTO while PAUSED", async () => {
    const { deps, state } = makeDeps({
      ...SKILL,
      mode: SkillMode.MANUAL,
      status: SkillStatus.PAUSED,
    });
    const result = await makeSetSkillMode(deps)({
      skillId: 10,
      userId: 7,
      mode: SkillMode.AUTOMATIC,
    });

    expect(result.ok).toBe(true);
    expect(state.cleared).toEqual([10]);
    expect(state.durableEnqueued).toEqual([]);
    expect(state.enqueued).toEqual([]);
  });
});
