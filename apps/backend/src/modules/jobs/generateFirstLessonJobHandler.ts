import { logger } from "@/lib/logger";

import { type SkillFirstLessonJobPayload } from "@/modules/tutoring/application/generate-first-lesson";
import type { GenerateFirstLesson } from "@/modules/tutoring/application/generate-first-lesson";

export const getGenerateFirstLessonJobHandler = (
  generateFirstLesson: GenerateFirstLesson,
) => {
  return async (payload: SkillFirstLessonJobPayload) => {
    const result = await generateFirstLesson(payload);
    if (!result.ok) {
      logger.error(
        { skillId: payload.skillId, error: result.error },
        "First lesson failed; skill marked FAILED",
      );
    }
  };
};
