import { ok, type Result } from "@/modules/platform/result";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";

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
};
export type CreateSkillOutput = {
  id: number;
  status: string;
};

/**
 * Create the Skill shell (DRAFT) and hand the expensive AI initialization to
 * the job queue. Returns immediately with the shell so the client gets an id
 * and can poll — identical behavior to the old controller-level runDetached.
 */
export const makeCreateSkill =
  ({ skillRepo, jobs }: CreateSkillDeps) =>
  async (
    input: CreateSkillInput,
  ): Promise<Result<CreateSkillOutput, never>> => {
    const skill = await skillRepo.create({
      userId: input.userId,
      topic: input.topic,
    });

    jobs.enqueue(SKILL_INIT_JOB, {
      skillId: skill.id,
      userId: input.userId,
      topic: input.topic,
    } satisfies SkillInitJobPayload);

    return ok(skill);
  };
