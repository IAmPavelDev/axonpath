import { err, ok, type Result } from "@/modules/platform/result";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { SKILL_INIT_JOB, type SkillInitJobPayload } from "./create-skill";
import {
  SKILL_FIRST_LESSON_JOB,
  type SkillFirstLessonJobPayload,
} from "@/modules/tutoring/application/generate-first-lesson";
import { drainCapped } from "./ensure-skill-lessons";

export type RetrySkillDeps = {
  skillRepo: SkillRepository;
  jobs: JobQueuePort;
  /** Drain seam — the container's jobQueueIdle (see drainCapped). */
  awaitDrain: () => Promise<void>;
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
 * re-enqueue the job that failed. Ownership is checked here (NotOwned maps
 * to 404 so existence is not leaked) and the guard is explicitly
 * FAILED-only: ACTIVE re-enters GENERATING only through the adaptive loop
 * (submit-quiz) or the first-lesson acceptance, never through a retry.
 *
 * The failed stage follows from what already landed: a description on the
 * row means the metadata stage succeeded and the first-lesson pipeline
 * died — retry stage 2; otherwise the draft itself never arrived — retry
 * stage 1 from the stored prompt.
 *
 * A retry is always safe to run: both pipelines no-op when their work
 * already exists, so a duplicate or repeated retry cannot corrupt an
 * existing skill.
 */
export const makeRetrySkill =
  ({ skillRepo, jobs, awaitDrain }: RetrySkillDeps) =>
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
    if (skill.status !== SkillStatus.FAILED) {
      return err({
        kind: "InvalidSkillTransition",
        from: skill.status as SkillStatus,
        to: SkillStatus.GENERATING,
      });
    }

    const updated = await skillRepo.update(input.skillId, {
      status: SkillStatus.GENERATING,
    });

    if (skill.description.length > 0) {
      jobs.enqueue(SKILL_FIRST_LESSON_JOB, {
        skillId: input.skillId,
        userId: skill.userId,
      } satisfies SkillFirstLessonJobPayload);
    } else {
      jobs.enqueue(SKILL_INIT_JOB, {
        skillId: input.skillId,
        userId: skill.userId,
        prompt: skill.prompt,
      } satisfies SkillInitJobPayload);
    }
    // Same serverless freeze as the acceptance edit: drain in-request
    // (capped) so the retried stage usually lands within this request.
    await drainCapped(awaitDrain);

    return ok({ status: updated.status });
  };
