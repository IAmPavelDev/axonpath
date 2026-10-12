import { err, ok, type Result } from "@/modules/platform/result";

/**
 * SponsorBlock community-segment client (read-only). Skipping in-video
 * sponsorships and subscribe-nags is the legitimate half of "no ads in the
 * player" — pre-roll ads inside the official embed are YouTube's to serve and
 * cannot be removed without violating their ToS. Educational categories
 * (intro/outro/chapter) are deliberately NOT skipped: they may be lesson
 * material.
 */
export type SponsorSegment = {
  startSeconds: number;
  endSeconds: number;
  category: string;
};

export type SponsorError = { kind: "HttpRequestFailed" | "ParseFailed"; detail: string };

const CATEGORIES = ["sponsor", "selfpromo", "interaction"];
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 6_000;

export type SponsorClient = {
  fetchSegments(videoId: string): Promise<Result<SponsorSegment[], SponsorError>>;
};

type CacheEntry = { segments: SponsorSegment[]; fetchedAt: number };
const cache = new Map<string, CacheEntry>();

export const parseSkipSegments = (raw: unknown): SponsorSegment[] => {
  if (!Array.isArray(raw)) return [];
  const segments: SponsorSegment[] = [];
  for (const entry of raw) {
    const rec = entry as { segment?: unknown; category?: unknown };
    if (!Array.isArray(rec.segment) || rec.segment.length !== 2) continue;
    const [start, end] = rec.segment as unknown[];
    const category = typeof rec.category === "string" ? rec.category : "";
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (end - start < 1) continue;
    segments.push({ startSeconds: start, endSeconds: end, category });
  }
  return segments;
};

export const makeSponsorClient = (): SponsorClient => ({
  fetchSegments: async (videoId) => {
    const cached = cache.get(videoId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return ok(cached.segments);
    }
    let res: Response;
    try {
      res = await fetch(
        `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
    } catch (e) {
      return err({ kind: "HttpRequestFailed", detail: (e as Error).message });
    }
    // 404 = no submissions for this video — cache the empty result too.
    if (res.status === 404) {
      cache.set(videoId, { segments: [], fetchedAt: Date.now() });
      return ok([]);
    }
    if (!res.ok) {
      return err({ kind: "HttpRequestFailed", detail: `sponsor HTTP ${res.status}` });
    }
    let raw: unknown;
    try {
      raw = (await res.json()) as unknown;
    } catch {
      return err({ kind: "ParseFailed", detail: "sponsor response was not JSON" });
    }
    const segments = parseSkipSegments(raw);
    cache.set(videoId, { segments, fetchedAt: Date.now() });
    return ok(segments);
  },
});
