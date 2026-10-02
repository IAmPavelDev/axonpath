import { describe, expect, it } from "vitest";
import {
  makeSetSkillStatus,
  USER_SETTABLE_STATUSES,
  type SetSkillStatusDeps,
} from "./set-skill-status";
import { NextClassOptionsState, SkillMode, SkillStatus } from "@/prisma/generated";
import { ok } from "@/modules/platform/result";
import type {
  SkillCoreRow,
  SkillRepository,
} from "@/modules/learning/domain/skill/skill.repository";

const unused = async (): Promise<never> => {
  throw new Error("not used in set-status tests");
};

/** Test seam: in-memory skill repo capturing status updates. */
const makeFakeDeps = (
  skill: SkillCoreRow | null,
) => {
  const updates: { id: number; patch: Record<string, unknown> }[] = [];

  const skillRepo: SkillRepository = {
    create: unused,
    update: async (id, patch) => {
      updates.push({ id, patch });
      return {
        id,
        topic: "SQL joins",
        description: "",
        status: patch.status ?? SkillStatus.ACTIVE,
        mode: SkillMode.AUTOMATIC,
        optionsState: NextClassOptionsState.NONE,
        optionsStateAt: null,
      };
    },
    findById: async () => skill,
    listByUser: unused,
    listByStatus: unused,
  };

  const deps: SetSkillStatusDeps = { skillRepo };
  return { deps, updates };
};

describe("makeSetSkillStatus", () => {
  const input = { skillId: 42, userId: 7 };
  const skillWithStatus = (status: string) => ({
    id: 42,
    userId: 7,
    topic: "SQL joins",
    description: "",
    status,
    mode: SkillMode.AUTOMATIC,
    optionsState: NextClassOptionsState.NONE,
    optionsStateAt: null,
  });

  it.each([
    ["pauses an ACTIVE skill", SkillStatus.ACTIVE, SkillStatus.PAUSED],
    ["resumes a PAUSED skill", SkillStatus.PAUSED, SkillStatus.ACTIVE],
    ["completes an ACTIVE skill", SkillStatus.ACTIVE, SkillStatus.COMPLETED],
    ["completes a PAUSED skill", SkillStatus.PAUSED, SkillStatus.COMPLETED],
    ["archives a COMPLETED skill", SkillStatus.COMPLETED, SkillStatus.ARCHIVED],
  ])("%s", async (_name, from, to) => {
    const { deps, updates } = makeFakeDeps(skillWithStatus(from));

    const result = await makeSetSkillStatus(deps)({ ...input, status: to });

    expect(result).toEqual(ok({ status: to }));
    expect(updates).toEqual([{ id: 42, patch: { status: to } }]);
  });

  it("rejects a machine-managed target (GENERATING) even from a legal state", async () => {
    const { deps, updates } = makeFakeDeps(skillWithStatus(SkillStatus.ACTIVE));

    const result = await makeSetSkillStatus(deps)({
      ...input,
      status: SkillStatus.GENERATING,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "InvalidSkillTransition",
        from: SkillStatus.ACTIVE,
        to: SkillStatus.GENERATING,
      },
    });
    expect(updates).toHaveLength(0);
  });

  it("rejects a machine-managed target (FAILED) even from a legal state", async () => {
    const { deps, updates } = makeFakeDeps(skillWithStatus(SkillStatus.ACTIVE));

    const result = await makeSetSkillStatus(deps)({
      ...input,
      status: SkillStatus.FAILED,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "InvalidSkillTransition",
        from: SkillStatus.ACTIVE,
        to: SkillStatus.FAILED,
      },
    });
    expect(updates).toHaveLength(0);
  });

  it("rejects a whitelisted target the state machine forbids (COMPLETED → PAUSED)", async () => {
    const { deps, updates } = makeFakeDeps(
      skillWithStatus(SkillStatus.COMPLETED),
    );

    const result = await makeSetSkillStatus(deps)({
      ...input,
      status: SkillStatus.PAUSED,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "InvalidSkillTransition",
        from: SkillStatus.COMPLETED,
        to: SkillStatus.PAUSED,
      },
    });
    expect(updates).toHaveLength(0);
  });

  it("rejects waking an ARCHIVED skill (terminal)", async () => {
    const { deps, updates } = makeFakeDeps(
      skillWithStatus(SkillStatus.ARCHIVED),
    );

    const result = await makeSetSkillStatus(deps)({
      ...input,
      status: SkillStatus.ACTIVE,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "InvalidSkillTransition",
        from: SkillStatus.ARCHIVED,
        to: SkillStatus.ACTIVE,
      },
    });
    expect(updates).toHaveLength(0);
  });

  it("rejects a skill the user does not own", async () => {
    const { deps, updates } = makeFakeDeps(
      skillWithStatus(SkillStatus.ACTIVE),
    );
    const foreign = { ...input, userId: 99 };

    const result = await makeSetSkillStatus(deps)({
      ...foreign,
      status: SkillStatus.PAUSED,
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotOwned", skillId: 42 } });
    expect(updates).toHaveLength(0);
  });

  it("reports SkillNotFound when the skill does not exist", async () => {
    const { deps } = makeFakeDeps(null);

    const result = await makeSetSkillStatus(deps)({
      ...input,
      status: SkillStatus.PAUSED,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "SkillNotFound", skillId: 42 },
    });
  });

  it("exposes exactly the four user-settable statuses", () => {
    expect(USER_SETTABLE_STATUSES).toEqual([
      SkillStatus.PAUSED,
      SkillStatus.ACTIVE,
      SkillStatus.COMPLETED,
      SkillStatus.ARCHIVED,
    ]);
  });
});
