import type { AiPort } from "@/modules/tutoring/ports";
import { extractJsonObject } from "@/modules/tutoring/domain/parse";
import type { RankedRecommendation } from "@/modules/video/domain/video-enrichment";
import type { YouTubeScraperPort } from "@/modules/video/domain/youtube-access";
import { rankCandidates } from "@/modules/video/domain/video-enrichment";
import type {
  NewRecommendation,
  VideoRepository,
} from "@/modules/video/domain/video-repos";

export const SKILL_RECOMMENDATIONS_JOB = "skill-recommendations";

export type GenerateSkillRecommendations = (input: { skillId: number }) => Promise<void>;

export type GenerateSkillRecommendationsDeps = {
  videoRepo: VideoRepository;
  search: Pick<YouTubeScraperPort, "searchYouTube">;
  /** Rerank only — the model reorders/trims heuristic candidates, never invents. */
  ai: Pick<AiPort, "generateJson">;
  /** Permanent give-up: this many failed attempts flips the skill to FAILED. */
  maxAttempts?: number;
};

const RERANK_SYSTEM =
  "You rank educational YouTube videos for a learning app. Reply with JSON only.";

const RERANK_SCHEMA = {
  type: "object",
  properties: { ranked: { type: "array", items: { type: "integer" } } },
  required: ["ranked"],
};

/** A model pass only pays off above this candidate count. */
const RERANK_THRESHOLD = 10;

type ParsedRerank = { ranked?: unknown };

/**
 * Top-10 whole-video recommendations for one skill's topic. Heuristic
 * candidates → model rerank → persisted rows. Any failure leaves the skill
 * PENDING (the sweeper retries); after maxAttempts it becomes FAILED and the
 * tab shows a quiet retry affordance instead of spinning forever.
 */
export const makeGenerateSkillRecommendations =
  ({ videoRepo, search, ai, maxAttempts = 3 }: GenerateSkillRecommendationsDeps) =>
  async (input: { skillId: number }): Promise<void> => {
    const state = await videoRepo.getRecommendationsState(input.skillId);
    if (state.status === "READY") return; // job replay no-op
    if (state.attempts > maxAttempts) {
      await videoRepo.setRecommendationsStatus(input.skillId, "FAILED");
      return;
    }
    const topic = await videoRepo.findSkillTopic(input.skillId);
    if (!topic) return; // skill vanished (deleted mid-enrichment)

    const searchResult = await search.searchYouTube(`${topic} tutorial explained`, {
      innertubeApiKey: null,
      innertubeClientVersion: null,
    });
    if (!searchResult.ok) {
      if (state.attempts >= maxAttempts) {
        await videoRepo.setRecommendationsStatus(input.skillId, "FAILED");
      }
      return;
    }

    const ranked = rankCandidates(searchResult.value, topic, 15);
    const order = await rerankWithModel(ai, topic, ranked);

    const items: NewRecommendation[] = [];
    order.forEach((position, rank) => {
      const candidate = ranked[position];
      if (!candidate) return;
      items.push({
        videoId: candidate.hit.videoId,
        title: candidate.hit.title,
        channel: candidate.hit.channel,
        durationSeconds: candidate.hit.durationSeconds,
        rank: rank + 1,
        score: candidate.score,
      });
    });

    // Search worked but everything ranked away — still READY, with an empty
    // list the tab renders as "no videos found for this topic yet".
    await videoRepo.replaceRecommendations(input.skillId, items.slice(0, 10));
    await videoRepo.setRecommendationsStatus(input.skillId, "READY");
  };

/**
 * Model rerank: one generateJson call returning best-first candidate indexes.
 * Falls back to heuristic order on any parse/shape problem — the feature
 * degrades to the heuristic ranking, never to an error.
 */
const rerankWithModel = async (
  ai: Pick<AiPort, "generateJson">,
  topic: string,
  ranked: RankedRecommendation[],
): Promise<number[]> => {
  if (ranked.length <= RERANK_THRESHOLD) {
    return ranked.map((_, index) => index);
  }
  const listing = ranked
    .map(
      (candidate, index) =>
        `${index}: ${candidate.hit.title} — ${candidate.hit.channel} — ${Math.round((candidate.hit.durationSeconds ?? 0) / 60)} min — ${candidate.hit.viewCountText ?? "views unknown"}`,
    )
    .join("\n");
  const result = await ai.generateJson(
    {
      system: RERANK_SYSTEM,
      prompt: `Topic: "${topic}"\nCandidates:\n${listing}\nReturn the indexes of the 10 best educational videos, best first, most reliable channels first.`,
    },
    {
      schemaName: "video-recommendation-rerank",
      responseSchema: RERANK_SCHEMA as Record<string, unknown>,
    },
  );
  const heuristicOrder = ranked.map((_, index) => index);
  if (!result.ok) return heuristicOrder;

  const parsed = extractJsonObject(result.value.raw) as ParsedRerank | null;
  const rawList = Array.isArray(parsed?.ranked) ? parsed.ranked : [];
  const seen = new Set<number>();
  const deduped: number[] = [];
  for (const index of rawList) {
    if (typeof index !== "number" || index < 0 || index >= ranked.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    deduped.push(index);
  }
  for (const index of heuristicOrder) {
    if (!seen.has(index)) deduped.push(index);
  }
  return deduped.slice(0, 10);
};
