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
  SKILL_CLASS_OPTIONS_JOB,
  type SkillClassOptionsJobPayload,
} from "@/modules/tutoring/application/generate-class-options";
import {
  SKILL_NEXT_CLASS_JOB,
  type SkillNextClassJobPayload,
} from "@/modules/tutoring/application/generate-next-class";
import type { NextClassJobRepository } from "@/modules/jobs/next-class-job.repository";

export type SetSkillModeDeps = {
  skillRepo: SkillRepository;
  optionRepo: NextClassOptionRepository;
  jobs: JobQueuePort;
  nextClassJobs: NextClassJobRepository;
};
export type SetSkillModeInput = {
  skillId: number;
  userId: number;
  mode: SkillMode;
};
export type SetSkillModeOutput = { status: string };

export type SetSkillModeError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number }
  | { kind: "SkillModeChangeNotAllowed"; skillId: number; status: SkillStatus };

/**
 * Learnable states only: switching modes mid-GENERATION (a pipeline is
 * composing a lesson) or on a FAILED skill would race the in-flight work.
 */
const MODE_CHANGEABLE: SkillStatus[] = [SkillStatus.ACTIVE, SkillStatus.PAUSED];

/**
 * Switch how the next lesson is chosen.
 *
 * AUTO -> MANUAL: arms the candidate-options job so a direction set is
 * ready (or in flight) by the time the learner opens the picker; a PAUSED
 * skill gets no set (the options job gates on ACTIVE) — the client's
 * refresh path covers resume.
 * MANUAL -> AUTO: consumes the candidate set and, for an ACTIVE skill whose
 * newest lesson is already completed, hands the skill to the durable
 * next-class pipeline (its retake-dedup no-ops when the newest lesson is
 * still unanswered, so the enqueue is always safe).
 */
export const makeSetSkillMode =
  ({ skillRepo, optionRepo, jobs, nextClassJobs }: SetSkillModeDeps) =>
  async (
    input: SetSkillModeInput,
  ): Promise<Result<SetSkillModeOutput, SetSkillModeError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }
    if (!MODE_CHANGEABLE.includes(skill.status as SkillStatus)) {
      return err({
        kind: "SkillModeChangeNotAllowed",
        skillId: input.skillId,
        status: skill.status as SkillStatus,
      });
    }

    const current = skill.mode as SkillMode;
    if (current === input.mode) {
      return ok({ status: skill.status });
    }

    await skillRepo.update(input.skillId, { mode: input.mode });

    if (input.mode === SkillMode.MANUAL) {
      if (skill.status === SkillStatus.ACTIVE) {
        await skillRepo.update(input.skillId, {
          optionsState: NextClassOptionsState.PENDING,
          optionsStateAt: new Date(),
        });
        jobs.enqueue(SKILL_CLASS_OPTIONS_JOB, {
          skillId: input.skillId,
          userId: input.userId,
        } satisfies SkillClassOptionsJobPayload);
      }
    } else {
      await optionRepo.clearForSkill(input.skillId);
      await skillRepo.update(input.skillId, {
        optionsState: NextClassOptionsState.NONE,
        optionsStateAt: null,
      });
      if (skill.status === SkillStatus.ACTIVE) {
        await nextClassJobs.enqueue({ skillId: input.skillId, userId: input.userId });
        jobs.enqueue(SKILL_NEXT_CLASS_JOB, {
          skillId: input.skillId,
          userId: input.userId,
        } satisfies SkillNextClassJobPayload);
      }
    }

    return ok({ status: skill.status });
  };
