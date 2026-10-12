import { oc } from "@orpc/contract";
import * as schema from "../schema/video.schema.js";

const BASE_PATH = "/video";

const probe = oc
  .route({
    method: "POST",
    path: `${BASE_PATH}/probe`,
    summary:
      "Probe unofficial YouTube access paths (InnerTube search, watch page, transcript) from the current runtime",
    tags: ["Video", "Probe"],
  })
  .input(schema.ProbeYouTubeAccessInput)
  .output(schema.ProbeYouTubeAccessOutput);

const recommendations = {
  list: oc
    .route({
      method: "GET",
      path: `${BASE_PATH}/recommendations/list`,
      summary: "Top-10 whole-video recommendations for a skill (PENDING while generating)",
      tags: ["Video", "Recommendations", "List"],
    })
    .input(schema.SkillRecommendationsInput)
    .output(schema.SkillRecommendationsOutput),
  refresh: oc
    .route({
      method: "POST",
      path: `${BASE_PATH}/recommendations/refresh`,
      summary: "Re-run recommendations generation for a skill",
      tags: ["Video", "Recommendations", "Refresh"],
    })
    .input(schema.RefreshRecommendationsInput)
    .output(schema.RefreshRecommendationsOutput),
};

const sponsorSegments = oc
  .route({
    method: "GET",
    path: `${BASE_PATH}/sponsor-segments`,
    summary: "SponsorBlock community skip segments (sponsor/selfpromo/interaction) for a video",
    tags: ["Video", "SponsorBlock"],
  })
  .input(schema.SponsorSegmentsInput)
  .output(schema.SponsorSegmentsOutput);

export const videoContract = {
  probe,
  recommendations,
  sponsorSegments,
};

export type VideoContractType = typeof videoContract;
