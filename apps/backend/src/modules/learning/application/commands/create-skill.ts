import { ok, type Result } from "@/modules/platform/result";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";

export const SKILL_INIT_JOB = "skill-init";

/** Skill.topic column width — the placeholder topic must fit it. */
export const CREATE_TOPIC_MAX = 255;

export type SkillInitJobPayload = {
  skillId: number;
  userId: number;
  prompt: string;
};

export type CreateSkillDeps = {
  skillRepo: SkillRepository;
  jobs: JobQueuePort;
};
export type CreateSkillInput = {
  userId: number;
  /** The learner's freeform brief: what they want to learn, goal, level. */
  prompt: string;
};
export type CreateSkillOutput = {
  id: number;
  status: string;
};

/**
 * Create the Skill shell and hand the expensive work to the job queue.
 * Returns immediately with the shell so the client gets an id and can poll.
 *
 * The shell starts GENERATING with the prompt clipped as a placeholder
 * topic; the init job (stage 1) generates the title + description from the
 * prompt and settles ACTIVE with zero classes. The learner reviews that
 * draft in the UI; accepting it (skill.edit on the lesson-less ACTIVE
 * skill) arms the "skill-first-lesson" job (stage 2).
 */
export const makeCreateSkill =
  ({ skillRepo, jobs }: CreateSkillDeps) =>
  async (
    input: CreateSkillInput,
  ): Promise<Result<CreateSkillOutput, never>> => {
    const skill = await skillRepo.create({
      userId: input.userId,
      prompt: input.prompt,
      topic: input.prompt.slice(0, CREATE_TOPIC_MAX),
      status: SkillStatus.GENERATING,
    });

    jobs.enqueue(SKILL_INIT_JOB, {
      skillId: skill.id,
      userId: input.userId,
      prompt: input.prompt,
    } satisfies SkillInitJobPayload);

    return ok(skill);
  };
