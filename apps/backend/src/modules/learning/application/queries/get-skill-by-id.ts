import { err, ok, type Result } from "@/modules/platform/result";
import type { SkillError } from "@/modules/learning/domain/skill/skill";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";

export type GetSkillByIdDeps = { skillRepo: SkillRepository };
export type GetSkillByIdInput = { skillId: number };
export type GetSkillByIdOutput = {
  id: number;
  topic: string;
  description: string;
  status: string;
};

export const makeGetSkillById =
  ({ skillRepo }: GetSkillByIdDeps) =>
  async (
    input: GetSkillByIdInput,
  ): Promise<Result<GetSkillByIdOutput, SkillError>> => {
    const skill = await skillRepo.findById(input.skillId);

    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }

    return ok(skill);
  };
