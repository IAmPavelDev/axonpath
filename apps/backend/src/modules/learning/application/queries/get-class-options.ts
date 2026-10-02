import { err, ok, type Result } from "@/modules/platform/result";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type {
  NextClassOptionRepository,
  NextClassOptionRow,
} from "@/modules/learning/domain/skill/next-class-option.repository";
import type { NextClassOptionsState } from "@/prisma/generated";

export type GetClassOptionsDeps = {
  skillRepo: SkillRepository;
  optionRepo: NextClassOptionRepository;
};
export type GetClassOptionsInput = {
  skillId: number;
  userId: number;
};
export type GetClassOptionsOutput = {
  state: NextClassOptionsState;
  optionsStateAt: Date | null;
  options: NextClassOptionRow[];
};
export type GetClassOptionsError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number };

/**
 * Read the MANUAL-mode candidate set: the lifecycle state plus the ranked
 * directions when READY. The client polls while PENDING (the job is quick —
 * one AI request) and renders the picker on READY.
 */
export const makeGetClassOptions =
  ({ skillRepo, optionRepo }: GetClassOptionsDeps) =>
  async (
    input: GetClassOptionsInput,
  ): Promise<Result<GetClassOptionsOutput, GetClassOptionsError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }

    return ok({
      state: skill.optionsState,
      optionsStateAt: skill.optionsStateAt,
      options: await optionRepo.listBySkill(input.skillId),
    });
  };
