import { err, ok, type Result } from "@/modules/platform/result";
import { NextClassOptionsState, SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  SKILL_CLASS_OPTIONS_JOB,
  type SkillClassOptionsJobPayload,
} from "@/modules/tutoring/application/generate-class-options";

export type RefreshClassOptionsDeps = {
  skillRepo: SkillRepository;
  jobs: JobQueuePort;
};
export type RefreshClassOptionsInput = {
  skillId: number;
  userId: number;
};
export type RefreshClassOptionsOutput = {
  state: NextClassOptionsState;
  optionsStateAt: Date | null;
  options: never[];
};

export type RefreshClassOptionsError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number }
  | { kind: "OptionsRefreshNotAllowed"; skillId: number; status: SkillStatus };

/**
 * (Re)generate the MANUAL-mode candidate set — the entry point when the
 * picker opens with nothing armed (state NONE, e.g. after a resume) and the
 * retry path after a FAILED generation. ACTIVE skills only; the job itself
 * re-checks.
 */
export const makeRefreshClassOptions =
  ({ skillRepo, jobs }: RefreshClassOptionsDeps) =>
  async (
    input: RefreshClassOptionsInput,
  ): Promise<Result<RefreshClassOptionsOutput, RefreshClassOptionsError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }
    if (skill.status !== SkillStatus.ACTIVE) {
      return err({
        kind: "OptionsRefreshNotAllowed",
        skillId: input.skillId,
        status: skill.status as SkillStatus,
      });
    }

    const armedAt = new Date();
    await skillRepo.update(input.skillId, {
      optionsState: NextClassOptionsState.PENDING,
      optionsStateAt: armedAt,
    });
    jobs.enqueue(SKILL_CLASS_OPTIONS_JOB, {
      skillId: input.skillId,
      userId: input.userId,
    } satisfies SkillClassOptionsJobPayload);

    return ok({
      state: NextClassOptionsState.PENDING,
      optionsStateAt: armedAt,
      options: [],
    });
  };
