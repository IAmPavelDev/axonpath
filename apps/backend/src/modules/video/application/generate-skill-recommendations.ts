import {
  generationFailed,
  generationStarted,
  generationSucceeded,
} from "@/lib/generation-logger";

import type { AiPort } from "@/modules/tutoring/ports";
import { extractJsonObject } from "@/modules/tutoring/domain/parse";
import type { RankedRecommendation } from "@/modules/video/domain/video-enrichment";
import type { YouTubeScraperPort } from "@/modules/video/domain/youtube-access";
import type { YouTubeSearchHit } from "@/modules/video/domain/youtube-access";
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

const LANGUAGE_SELECT_SYSTEM =
  "You select educational YouTube videos in a required language. Reply with JSON only.";

const LANGUAGE_SELECT_SCHEMA = {
  type: "object",
  properties: { ranked: { type: "array", items: { type: "integer" } } },
  required: ["ranked"],
  additionalProperties: false,
} as const;

const LANGUAGE_CLASSIFY_SYSTEM =
  "You detect the language a learning skill will be taught in. Reply with JSON only.";

const LANGUAGE_CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", pattern: "^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$" },
  },
  required: ["language"],
  additionalProperties: false,
} as const;

const BCP47_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/;

/**
 * The skill's video language: the latest lesson's AI-decided baseLanguage,
 * or — before lesson 0 exists (recommendations usually generate first) —
 * one cheap classification of the learner's own prompt.
 */
const resolveSkillLanguage = async (
  videoRepo: VideoRepository,
  ai: Pick<AiPort, "generateJson">,
  skillId: number,
  topic: string,
): Promise<string | null> => {
  const fromLessons = await videoRepo.findSkillLanguage(skillId);
  if (fromLessons !== null) return fromLessons;
  const result = await ai.generateJson(
    {
      system: LANGUAGE_CLASSIFY_SYSTEM,
      prompt: [
        "The learner described a skill they want to learn:",
        `"""${topic.slice(0, 500)}"""`,
        "The lessons will be written in the learner's own language.",
        'Answer JSON: {"language": "BCP-47 code"}',
      ].join("\n"),
    },
    {
      schemaName: "skill_language",
      responseSchema: LANGUAGE_CLASSIFY_SCHEMA as Record<string, unknown>,
    },
  );
  if (!result.ok) return null;
  const parsed = extractJsonObject(result.value.raw) as { language?: unknown } | null;
  return typeof parsed?.language === "string" && BCP47_RE.test(parsed.language)
    ? parsed.language
    : null;
};

/**
 * Model language gate over the raw search hits: only videos that teach in
 * the required language survive, best-first. Returns null only when the
 * model call itself fails — the caller then degrades to the unfiltered
 * heuristic path. An empty selection is a real verdict (no matching-language
 * videos in the results) and persists as an empty list.
 */
const selectByLanguage = async (
  ai: Pick<AiPort, "generateJson">,
  topic: string,
  hits: YouTubeSearchHit[],
  language: string,
): Promise<YouTubeSearchHit[] | null> => {
  const capped = hits.slice(0, 25);
  const list = capped
    .map((hit, index) => `${index}. "${hit.title}" — ${hit.channel}`)
    .join("\n");
  const result = await ai.generateJson(
    {
      system: LANGUAGE_SELECT_SYSTEM,
      prompt: [
        `Skill topic: "${topic}"`,
        `Required video language: ${language} (BCP-47). The videos must TEACH in it.`,
        "Candidates (index. title — channel):",
        list,
        "",
        "Select every candidate whose teaching language matches, judging from the",
        "title and channel. A tutorial advertised for another language (e.g. 'in",
        "Hindi') never qualifies, however well its topic matches.",
        "Return the selected indexes best-first for the topic.",
        'Answer JSON: {"ranked": number[]}',
      ].join("\n"),
    },
    {
      schemaName: "video_language_select",
      responseSchema: LANGUAGE_SELECT_SCHEMA as Record<string, unknown>,
    },
  );
  if (!result.ok) return null;
  const parsed = extractJsonObject(result.value.raw) as { ranked?: unknown } | null;
  if (!Array.isArray(parsed?.ranked)) return null;
  const picked = parsed.ranked.filter(
    (index): index is number =>
      typeof index === "number" &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < capped.length,
  );
  return [...new Set(picked)].map((index) => capped[index]);
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
    const pipelineStartedAt = Date.now();
    const state = await videoRepo.getRecommendationsState(input.skillId);
    if (state.status === "READY") return; // job replay no-op
    if (state.attempts > maxAttempts) {
      generationFailed(
        { pipeline: "recommendations", skillId: input.skillId },
        {
          durationMs: Date.now() - pipelineStartedAt,
          errorKind: "AttemptsExhausted",
          attempt: state.attempts,
          maxAttempts,
        },
      );
      await videoRepo.setRecommendationsStatus(input.skillId, "FAILED");
      return;
    }
    const topic = await videoRepo.findSkillTopic(input.skillId);
    if (!topic) return; // skill vanished (deleted mid-enrichment)

    generationStarted({
      pipeline: "recommendations",
      skillId: input.skillId,
      skillName: topic,
    });

    const searchResult = await search.searchYouTube(`${topic} tutorial explained`, {
      innertubeApiKey: null,
      innertubeClientVersion: null,
    });
    if (!searchResult.ok) {
      generationFailed(
        {
          pipeline: "recommendations",
          skillId: input.skillId,
          skillName: topic,
        },
        {
          durationMs: Date.now() - pipelineStartedAt,
          errorKind: searchResult.error.kind,
          errorDetail: searchResult.error.detail,
          attempt: state.attempts,
          maxAttempts,
        },
      );
      if (state.attempts >= maxAttempts) {
        await videoRepo.setRecommendationsStatus(input.skillId, "FAILED");
      }
      return;
    }

    // Language gate first: a wrong-language list is the failure mode this
    // pipeline exists to prevent (popular regional content dominates topic
    // searches). Degrades to the unfiltered heuristic path only when the
    // model pass itself fails; an empty selection persists as an empty list.
    const language = await resolveSkillLanguage(videoRepo, ai, input.skillId, topic);
    if (language !== null) {
      const selected = await selectByLanguage(ai, topic, searchResult.value, language);
      if (selected !== null) {
        const items: NewRecommendation[] = selected.map((hit, index) => ({
          videoId: hit.videoId,
          title: hit.title,
          channel: hit.channel,
          durationSeconds: hit.durationSeconds,
          rank: index + 1,
          score: null,
        }));
        generationSucceeded(
          {
            pipeline: "recommendations",
            skillId: input.skillId,
            skillName: topic,
          },
          {
            durationMs: Date.now() - pipelineStartedAt,
            count: items.slice(0, 10).length,
            language,
          },
        );
        await videoRepo.replaceRecommendations(input.skillId, items.slice(0, 10));
        await videoRepo.setRecommendationsStatus(input.skillId, "READY");
        return;
      }
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

    generationSucceeded(
      {
        pipeline: "recommendations",
        skillId: input.skillId,
        skillName: topic,
      },
      {
        durationMs: Date.now() - pipelineStartedAt,
        count: items.slice(0, 10).length,
      },
    );
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
