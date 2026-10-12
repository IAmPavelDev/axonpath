import type { YouTubeSearchHit } from "@/modules/video/domain/youtube-access";

/** One lesson concept the model believes a video would teach better. */
export type ConceptQuery = {
  query: string;
  /** Zero-based conspect block the concept is anchored after. */
  anchorParagraph: number;
};

/** Model verdict for one class: does a video improve it, and which concepts. */
export type ClassConceptPlan = {
  helps: boolean;
  concepts: ConceptQuery[];
};

/** A candidate clip selected from a video's transcript. */
export type SelectedClip = {
  videoId: string;
  title: string;
  channel: string;
  startSeconds: number;
  endSeconds: number;
  summary: string;
};

/** Model output for one candidate video against one concept. */
export type ClipSelection =
  | { found: false }
  | { found: true; startSeconds: number; endSeconds: number; summary: string };

export type RankedRecommendation = {
  hit: YouTubeSearchHit;
  score: number;
};

/** "424,284 views" | "1.1M views" | "No views" → count; null when unparseable. */
export const parseViewCount = (text: string | null): number | null => {
  if (!text) return null;
  const cleaned = text.replace(/views/i, "").trim();
  const match = cleaned.match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!match) return null;
  const number = Number.parseFloat(match[1].replace(/,/g, ""));
  if (Number.isNaN(number)) return null;
  const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] ?? "").toLowerCase()] ?? 1;
  return Math.round(number * multiplier);
};

/**
 * Reliability heuristic for recommendation candidates: duration sanity
 * (4–90 min: real explanations, not shorts or podcasts), view counts as a
 * popularity proxy, and title/topic word overlap as a relevance floor.
 */
export const scoreCandidate = (hit: YouTubeSearchHit, topicWords: string[]): number => {
  let score = 0;
  const duration = hit.durationSeconds ?? 0;
  if (duration >= 240 && duration <= 5400) score += 2;
  const views = parseViewCount(hit.viewCountText);
  if (views !== null && views > 0) score += Math.min(3, Math.log10(views) / 2);
  if (views === null) score -= 1;
  const titleWords = hit.title.toLowerCase().split(/[^a-z0-9]+/);
  const overlap = topicWords.filter((word) =>
    titleWords.some((titleWord) => titleWord === word),
  ).length;
  score += Math.min(3, overlap);
  return score;
};

/**
 * Rank candidates by the reliability heuristic, keep the top `limit` — the
 * model rerank only reorders/trims these, it never invents candidates.
 */
export const rankCandidates = (
  hits: YouTubeSearchHit[],
  topic: string,
  limit = 10,
): RankedRecommendation[] => {
  const topicWords = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  return hits
    .map((hit) => ({ hit, score: scoreCandidate(hit, topicWords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

/**
 * Clamp a model-selected clip window to sane bounds: minimum 20 s of
 * teaching, maximum 8 min, never outside the video duration.
 */
export const clampClipWindow = (
  startSeconds: number,
  endSeconds: number,
  durationSeconds: number | null,
): { startSeconds: number; endSeconds: number } | null => {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return null;
  let start = Math.max(0, startSeconds);
  let end = endSeconds;
  if (durationSeconds !== null) end = Math.min(end, durationSeconds);
  if (end - start < 20) {
    const missing = 20 - (end - start);
    start = Math.max(0, start - missing);
    end = Math.min(durationSeconds ?? end + missing, end + missing);
  }
  if (end - start < 20) return null;
  if (end - start > 480) end = start + 480;
  if (end <= start) return null;
  return { startSeconds: Math.round(start * 10) / 10, endSeconds: Math.round(end * 10) / 10 };
};
