import { err, ok, type Result } from "@/modules/platform/result";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import { canTransition } from "@/modules/learning/domain/skill/skill";

export type SetSkillStatusDeps = { skillRepo: SkillRepository };
export type SetSkillStatusInput = {
  skillId: number;
  userId: number;
  status: SkillStatus;
};
export type SetSkillStatusOutput = {
  status: string;
};

export type SetSkillStatusError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number }
  | { kind: "InvalidSkillTransition"; from: SkillStatus; to: SkillStatus };

/**
 * User-settable lifecycle targets. GENERATING and FAILED are machine-managed
 * (the adaptive loop and retry own them), so they are rejected outright even
 * though the state machine knows edges from/to them.
 */
export const USER_SETTABLE_STATUSES: SkillStatus[] = [
  SkillStatus.PAUSED,
  SkillStatus.ACTIVE,
  SkillStatus.COMPLETED,
  SkillStatus.ARCHIVED,
];

/**
 * Set a skill's lifecycle status. The target must be user-settable AND legal
 * from the current state per the pure SKILL_TRANSITIONS machine — pausing,
 * resuming, completing, and archiving are the user's levers; everything else
 * stays with the pipeline. Ownership is checked here (NotOwned maps to 404
 * so existence is not leaked), and Archived skills remain reachable by id —
 * only skill.list hides them.
 */
export const makeSetSkillStatus =
  ({ skillRepo }: SetSkillStatusDeps) =>
  async (
    input: SetSkillStatusInput,
  ): Promise<Result<SetSkillStatusOutput, SetSkillStatusError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }

    const from = skill.status as SkillStatus;
    if (!USER_SETTABLE_STATUSES.includes(input.status)) {
      return err({
        kind: "InvalidSkillTransition",
        from,
        to: input.status,
      });
    }
    if (!canTransition(from, input.status)) {
      return err({
        kind: "InvalidSkillTransition",
        from,
        to: input.status,
      });
    }

    const updated = await skillRepo.update(input.skillId, {
      status: input.status,
    });
    return ok({ status: updated.status });
  };
