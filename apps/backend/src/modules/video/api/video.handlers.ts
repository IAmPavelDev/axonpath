import { ORPCError } from "@orpc/server";
import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import type { Clock } from "@/modules/platform/ports/clock";
import type { YouTubeScraperPort } from "@/modules/video/domain/youtube-access";
import type { VideoRepository } from "@/modules/video/domain/video-repos";
import type { SponsorClient } from "@/modules/video/infrastructure/sponsor.client";
import { makeProbeYoutubeAccess } from "@/modules/video/application/probe-youtube-access";

export type VideoApiDeps = {
  videoRepo: VideoRepository;
  sponsor: SponsorClient;
  scraper: YouTubeScraperPort;
  clock: Clock;
};

const assertSkillOwner = async (
  videoRepo: VideoRepository,
  skillId: number,
  userId: number,
): Promise<void> => {
  const owner = await videoRepo.findSkillOwner(skillId);
  if (owner !== userId) {
    throw new ORPCError("FORBIDDEN", { message: "Not your skill" });
  }
};

export const makeVideoHandlers = (deps: VideoApiDeps) => {
  const probeYoutubeAccess = makeProbeYoutubeAccess({
    scraper: deps.scraper,
    clock: deps.clock,
  });

  return {
    probe: (async ({ input }) =>
      probeYoutubeAccess({
        query: input.query,
        videoId: input.videoId ?? null,
      })) satisfies OrpcHandler<
      z.infer<typeof schema.video.ProbeYouTubeAccessInput>,
      z.infer<typeof schema.video.ProbeYouTubeAccessOutput>
    >,

    recommendationsList: (async ({ input, context }) => {
      await assertSkillOwner(deps.videoRepo, input.skillId, context.user.id);
      const [state, rows] = await Promise.all([
        deps.videoRepo.getRecommendationsState(input.skillId),
        deps.videoRepo.findRecommendations(input.skillId),
      ]);
      return {
        status: state.status ?? "PENDING",
        videos: rows.map((row) => ({
          videoId: row.videoId,
          title: row.title,
          channel: row.channel,
          durationSeconds: row.durationSeconds,
          rank: row.rank,
        })),
      };
    }) satisfies OrpcHandler<
      z.infer<typeof schema.video.SkillRecommendationsInput>,
      z.infer<typeof schema.video.SkillRecommendationsOutput>
    >,

    recommendationsRefresh: (async ({ input, context }) => {
      await assertSkillOwner(deps.videoRepo, input.skillId, context.user.id);
      const state = await deps.videoRepo.getRecommendationsState(input.skillId);
      if (state.status !== "PENDING") {
        // Re-arm: PENDING resets the attempts budget for a fresh run.
        await deps.videoRepo.setRecommendationsStatus(input.skillId, "PENDING");
      }
      return { status: "PENDING" };
    }) satisfies OrpcHandler<
      z.infer<typeof schema.video.RefreshRecommendationsInput>,
      z.infer<typeof schema.video.RefreshRecommendationsOutput>
    >,

    sponsorSegments: (async ({ input }) => {
      // Degrade silently: no segments (or SponsorBlock down) means the player
      // just plays straight through — skipping is never load-bearing.
      const result = await deps.sponsor.fetchSegments(input.videoId);
      return { segments: result.ok ? result.value : [] };
    }) satisfies OrpcHandler<
      z.infer<typeof schema.video.SponsorSegmentsInput>,
      z.infer<typeof schema.video.SponsorSegmentsOutput>
    >,
  };
};
