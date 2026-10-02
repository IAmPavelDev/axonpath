import { ok, type Result } from "@/modules/platform/result";
import { NextClassOptionsState, SkillMode, SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  SKILL_CLASS_OPTIONS_JOB,
  type SkillClassOptionsJobPayload,
} from "@/modules/tutoring/application/generate-class-options";

export const SKILL_INIT_JOB = "skill-init";

export type SkillInitJobPayload = {
  skillId: number;
  userId: number;
  topic: string;
};

export type CreateSkillDeps = {
  skillRepo: SkillRepository;
  jobs: JobQueuePort;
};
export type CreateSkillInput = {
  userId: number;
  topic: string;
  mode: SkillMode;
};
export type CreateSkillOutput = {
  id: number;
  status: string;
};

/**
 * Create the Skill shell and hand the expensive work to the job queue.
 * Returns immediately with the shell so the client gets an id and can poll.
 *
 * AUTOMATIC (default): shell starts GENERATING; the init job composes lesson
 * 0 and settles the status ACTIVE (or FAILED).
 * MANUAL: lesson 0 is the learner's call, so there is no init generation —
 * the shell starts ACTIVE immediately and the options job proposes three
 * ranked directions for the first lesson (PENDING until it lands).
 */
export const makeCreateSkill =
  ({ skillRepo, jobs }: CreateSkillDeps) =>
  async (
    input: CreateSkillInput,
  ): Promise<Result<CreateSkillOutput, never>> => {
    const manual = input.mode === SkillMode.MANUAL;
    const skill = await skillRepo.create({
      userId: input.userId,
      topic: input.topic,
      status: manual ? SkillStatus.ACTIVE : SkillStatus.GENERATING,
      mode: input.mode,
    });

    if (manual) {
      await skillRepo.update(skill.id, {
        optionsState: NextClassOptionsState.PENDING,
        optionsStateAt: new Date(),
      });
      jobs.enqueue(SKILL_CLASS_OPTIONS_JOB, {
        skillId: skill.id,
        userId: input.userId,
      } satisfies SkillClassOptionsJobPayload);
    } else {
      jobs.enqueue(SKILL_INIT_JOB, {
        skillId: skill.id,
        userId: input.userId,
        topic: input.topic,
      } satisfies SkillInitJobPayload);
    }

    return ok(skill);
  };
