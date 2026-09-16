import { type SkillInitJobPayload } from "@/modules/learning/application/commands/create-skill";
import type { GenerateInitialSkill } from "@/modules/tutoring/application/generate-initial-skill";

export const getGenerateInitialSkillJobHandler = (
  generateInitialSkill: GenerateInitialSkill,
) => {
  return async (payload: SkillInitJobPayload) => {
    const result = await generateInitialSkill(payload);
    if (!result.ok) {
      console.error(
        { skillId: payload.skillId, error: result.error },
        "Skill init failed; skill stays DRAFT",
      );
    }
  };
};
