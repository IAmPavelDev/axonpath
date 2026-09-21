import type {
  GenerateNextClass,
  SkillNextClassJobPayload,
} from "@/modules/tutoring/application/generate-next-class";

export const getGenerateNextClassJobHandler = (
  generateNextClass: GenerateNextClass,
) => {
  return async (payload: SkillNextClassJobPayload) => {
    const result = await generateNextClass(payload);
    if (!result.ok) {
      console.error(
        {
          skillId: payload.skillId,
          userId: payload.userId,
          error: result.error,
        },
        "Next-class generation failed; skill stays ACTIVE",
      );
    }
  };
};
