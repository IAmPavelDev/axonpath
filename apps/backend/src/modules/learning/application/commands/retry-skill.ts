import { err, ok, type Result } from "@/modules/platform/result";
import { SkillStatus } from "@/prisma/generated";
import { canTransition } from "@/modules/learning/domain/skill/skill";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { SKILL_INIT_JOB, type SkillInitJobPayload } from "./create-skill";

export type RetrySkillDeps = {
  skillRepo: SkillRepository;
  jobs: JobQueuePort;
};
export type RetrySkillInput = {
  skillId: number;
  userId: number;
};
export type RetrySkillOutput = {
  status: string;
};

export type RetrySkillError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number }
  | { kind: "InvalidSkillTransition"; from: SkillStatus; to: SkillStatus };

/**
 * Re-enter generation for a FAILED skill: flip it back to GENERATING and
 * re-enqueue the init job with the original create payload. Ownership is
 * checked here (NotOwned maps to 404 so existence is not leaked) and the
 * state machine guards the transition — only FAILED → GENERATING is legal.
 *
 * A retry is always safe to run: the init pipeline skips generation when any
 * class already exists, so a duplicate or repeated retry cannot corrupt an
 * existing skill.
 */
export const makeRetrySkill =
  ({ skillRepo, jobs }: RetrySkillDeps) =>
  async (
    input: RetrySkillInput,
  ): Promise<Result<RetrySkillOutput, RetrySkillError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }
    if (!canTransition(skill.status as SkillStatus, SkillStatus.GENERATING)) {
      return err({
        kind: "InvalidSkillTransition",
        from: skill.status as SkillStatus,
        to: SkillStatus.GENERATING,
      });
    }

    const updated = await skillRepo.update(input.skillId, {
      status: SkillStatus.GENERATING,
    });

    jobs.enqueue(SKILL_INIT_JOB, {
      skillId: input.skillId,
      userId: skill.userId,
      topic: skill.topic,
    } satisfies SkillInitJobPayload);

    return ok({ status: updated.status });
  };
