import { err, ok, type Result } from "@/modules/platform/result";
import {
  NextClassOptionsState,
  SkillMode,
  SkillStatus,
} from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type {
  NextClassOptionRepository,
} from "@/modules/learning/domain/skill/next-class-option.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  SKILL_NEXT_CLASS_JOB,
  type SkillNextClassJobPayload,
} from "@/modules/tutoring/application/generate-next-class";
import type { NextClassJobRepository } from "@/modules/jobs/next-class-job.repository";
import { canTransition } from "@/modules/learning/domain/skill/skill";

export type CreateClassDeps = {
  skillRepo: SkillRepository;
  optionRepo: NextClassOptionRepository;
  jobs: JobQueuePort;
  nextClassJobs: NextClassJobRepository;
};
export type CreateClassInput = {
  skillId: number;
  userId: number;
  /** The chosen (possibly edited) direction; becomes the lesson's target. */
  target: string;
};
export type CreateClassOutput = { status: string };

export type CreateClassError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number }
  | { kind: "ClassCreationNotAllowed"; skillId: number; status: SkillStatus };

/**
 * MANUAL-mode only: commit a candidate direction (or a custom one) and hand
 * it to the durable next-class pipeline. The skill enters its GENERATING
 * phase — the same "composing your next lesson" UX as the automatic loop —
 * and the pipeline composes the lesson around the target (lesson 0 when the
 * skill has no classes yet). The candidate set is consumed here: options
 * describe the next lesson, and this request is that lesson.
 */
export const makeCreateClass =
  ({ skillRepo, optionRepo, jobs, nextClassJobs }: CreateClassDeps) =>
  async (
    input: CreateClassInput,
  ): Promise<Result<CreateClassOutput, CreateClassError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }
    if (
      skill.mode !== SkillMode.MANUAL ||
      skill.status !== SkillStatus.ACTIVE ||
      !canTransition(skill.status as SkillStatus, SkillStatus.GENERATING)
    ) {
      return err({
        kind: "ClassCreationNotAllowed",
        skillId: input.skillId,
        status: skill.status as SkillStatus,
      });
    }

    await optionRepo.clearForSkill(input.skillId);
    await skillRepo.update(input.skillId, {
      status: SkillStatus.GENERATING,
      optionsState: NextClassOptionsState.NONE,
      optionsStateAt: null,
    });

    // Durable marker carries the target so a sweeper-recovered run still
    // composes the lesson the learner asked for.
    await nextClassJobs.enqueue({
      skillId: input.skillId,
      userId: input.userId,
      target: input.target,
    });
    jobs.enqueue(SKILL_NEXT_CLASS_JOB, {
      skillId: input.skillId,
      userId: input.userId,
      target: input.target,
    } satisfies SkillNextClassJobPayload);

    return ok({ status: SkillStatus.GENERATING });
  };
