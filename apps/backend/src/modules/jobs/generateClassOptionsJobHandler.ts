import { logger } from "@/lib/logger";

import type {
  GenerateClassOptions,
  SkillClassOptionsJobPayload,
} from "@/modules/tutoring/application/generate-class-options";

/**
 * The instant trigger for candidate-target generation. Failures already
 * settled the skill's options state to FAILED (client-visible, refreshable)
 * and recorded ERROR_OCCURRED — the handler only logs for observability.
 */
export const getGenerateClassOptionsJobHandler = (
  generateClassOptions: GenerateClassOptions,
) => {
  return async (payload: SkillClassOptionsJobPayload) => {
    const result = await generateClassOptions(payload);
    if (!result.ok) {
      logger.error({ ...payload, error: result.error }, "Class-options generation failed; skill options state is FAILED");
    }
  };
};
