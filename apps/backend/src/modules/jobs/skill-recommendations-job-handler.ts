import type { GenerateSkillRecommendations } from "@/modules/video/application/generate-skill-recommendations";

export type SkillRecommendationsJobPayload = { skillId: number };

/**
 * Recommendations generation: the sweeper is both trigger and recovery net
 * (status stays PENDING until a pass lands rows), so this handler is a thin
 * fire-and-forget shell — every failure path resolves silently and the
 * attempts budget decides between retry and FAILED.
 */
export const getSkillRecommendationsJobHandler =
  (generate: GenerateSkillRecommendations) =>
  async (payload: SkillRecommendationsJobPayload) => {
    await generate({ skillId: payload.skillId });
  };
