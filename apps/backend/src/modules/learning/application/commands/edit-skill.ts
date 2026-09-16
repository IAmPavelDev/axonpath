import { ok, type Result } from "@/modules/platform/result";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";

export type EditSkillDeps = { skillRepo: SkillRepository };
export type EditSkillInput = {
  id: number;
  topic?: string;
  description?: string;
};
export type EditSkillOutput = {
  id: number;
  topic: string;
  description: string;
  status: string;
};

/**
 * Partial update of an editable skill's own fields. Current editable fields:
 * topic and description. Status transitions are separate (see
 * domain/skill/skill.ts `canTransition`) and will get their own command when
 * the lifecycle is wired.
 */
export const makeEditSkill =
  ({ skillRepo }: EditSkillDeps) =>
  async (input: EditSkillInput): Promise<Result<EditSkillOutput, never>> => {
    const patch: { topic?: string; description?: string } = {};
    if (input.topic !== undefined) patch.topic = input.topic;
    if (input.description !== undefined) patch.description = input.description;

    if (Object.keys(patch).length === 0) {
      const current = await skillRepo.findById(input.id);
      return ok({
        id: current?.id ?? input.id,
        topic: current?.topic ?? "",
        description: current?.description ?? "",
        status: current?.status ?? "DRAFT",
      });
    }

    const updated = await skillRepo.update(input.id, patch);
    return ok(updated);
  };
