import { logger } from "@/lib/logger";

import { type SkillInitJobPayload } from "@/modules/learning/application/commands/create-skill";
import type { GenerateSkillMetadata } from "@/modules/tutoring/application/generate-skill-metadata";

export const getGenerateSkillMetadataJobHandler = (
  generateSkillMetadata: GenerateSkillMetadata,
) => {
  return async (payload: SkillInitJobPayload) => {
    const result = await generateSkillMetadata(payload);
    if (!result.ok) {
      logger.error(
        { skillId: payload.skillId, error: result.error },
        "Skill metadata failed; skill marked FAILED",
      );
    }
  };
};
