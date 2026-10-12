import { err, ok } from "@/modules/platform/result";
import type {
  CaptionTrack,
  TranscriptSegment,
  YouTubeScraperPort,
  YouTubeSearchHit,
} from "@/modules/video/domain/youtube-access";

/**
 * Dependency-free InnerTube client — the probe's instrument, not a production
 * scraper. It hits the same endpoints an InnerTube library would (watch page →
 * player response, /youtubei/v1/search, /youtubei/v1/player) with the standard
 * consent/browser headers, so a report from this code answers "are the
 * unofficial paths reachable from THIS runtime's IPs" without packaging noise.
 *
 * Measured 2026-10-12: WEB watch-page timedtext URLs return empty bodies on
 * every format (2024+ protection), and /youtubei/v1/get_transcript rejects
 * extracted page params with "Precondition check failed" — so transcripts are
 * fetched through the ANDROID player client, whose caption URLs serve real
 * tracks. Search and the watch page still work through the WEB surface.
 *
 * Parse shapes are YouTube-internal and drift without notice; every parser
 * fails into a Result, never throws.
 */

const TIMEOUT_MS = 7_000;
const PROBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";
const FALLBACK_CLIENT_VERSION = "2.20240304.00.00";
const ANDROID_CLIENT_VERSION = "20.10.38";
/** EU consent interstitial bypass cookies (community-standard values). */
const CONSENT_COOKIES =
  "CONSENT=YES+cb.20240101-00-p0.en+FX+000; SOCS=CAISEwgDEgk0Njc1NjQ4NTc4GgJlbiABGgYIgP_smgY";

const fetchWithTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: {
      "user-agent": PROBE_UA,
      "accept-language": "en-US,en;q=0.9",
      cookie: CONSENT_COOKIES,
      ...(init.headers as Record<string, string>),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

const asRec = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const asStr = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** Pull a nested path out of untyped parsed JSON without throwing. */
const pick = (root: unknown, path: Array<string | number>): unknown => {
  let node: unknown = root;
  for (const key of path) {
    if (Array.isArray(node)) {
      node = typeof key === "number" ? node[key] : undefined;
      continue;
    }
    const rec = asRec(node);
    if (!rec) return null;
    node = rec[key];
  }
  return node;
};

/**
 * Balanced-brace JSON extraction after a JS assignment marker — regex
 * `.+?` extraction breaks on nested objects, this does not.
 */
const extractJsonAfter = (html: string, marker: string): unknown => {
  const markerAt = html.indexOf(marker);
  if (markerAt === -1) return null;
  const objStart = html.indexOf("{", markerAt + marker.length);
  if (objStart === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = objStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(objStart, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};

/** "1:02:03" | "12:34" | "7" → seconds; null when unparseable. */
const parseDurationText = (text: string): number | null => {
  const parts = text
    .trim()
    .split(":")
    .map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p)) || parts.length === 0) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

/** Timedtext text arrives HTML-escaped and newline-littered. */
const decodeTranscriptText = (raw: string): string =>
  raw
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/**
 * srv3 timedtext XML: `<p t="80" d="4480" ...><s>text</s><s> more</s></p>`,
 * t/d in milliseconds. The ANDROID endpoint serves this format regardless of
 * the requested `fmt`.
 */
export const parseTimedtextXml = (xml: string): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = [];
  const paragraph = /<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  for (const match of xml.matchAll(paragraph)) {
    const startMs = Number.parseInt(match[1], 10);
    const text = decodeTranscriptText(
      match[3].replace(/<\/?s[^>]*>/g, " "),
    );
    if (!text || Number.isNaN(startMs)) continue;
    const durMs = match[2] ? Number.parseInt(match[2], 10) : null;
    segments.push({
      startSeconds: startMs / 1000,
      endSeconds: durMs !== null && !Number.isNaN(durMs) ? (startMs + durMs) / 1000 : null,
      text,
    });
  }
  return segments;
};

/** en-manual → en-auto → first track: educational probes prefer real captions. */
export const pickPreferredTrack = (tracks: CaptionTrack[]): CaptionTrack | null => {
  if (tracks.length === 0) return null;
  const english = tracks.filter((track) => track.languageCode.startsWith("en"));
  return english.find((track) => !track.isAutoGenerated) ?? english[0] ?? tracks[0];
};

const parseCaptionTracks = (playerResponse: unknown): CaptionTrack[] => {
  const tracks: CaptionTrack[] = [];
  const trackList = asRec(
    pick(playerResponse, ["captions", "playerCaptionsTracklistRenderer"]),
  );
  if (Array.isArray(trackList?.captionTracks)) {
    for (const raw of trackList.captionTracks) {
      const track = asRec(raw);
      const baseUrl = asStr(track?.baseUrl);
      if (!baseUrl) continue;
      tracks.push({
        baseUrl,
        languageCode: asStr(track?.languageCode) ?? "unknown",
        isAutoGenerated: asStr(track?.kind) === "asr",
      });
    }
  }
  return tracks;
};

const collectVideoRenderers = (node: unknown, out: unknown[]): void => {
  if (Array.isArray(node)) {
    for (const child of node) collectVideoRenderers(child, out);
    return;
  }
  const rec = asRec(node);
  if (!rec) return;
  if (asRec(rec.videoRenderer)) out.push(rec.videoRenderer);
  for (const value of Object.values(rec)) collectVideoRenderers(value, out);
};

const mapSearchHit = (renderer: unknown): YouTubeSearchHit | null => {
  const rec = asRec(renderer);
  const videoId = asStr(rec?.videoId);
  if (!videoId) return null;
  const title =
    asStr(pick(renderer, ["title", "simpleText"])) ??
    asStr(pick(renderer, ["title", "runs", 0, "text"])) ??
    "";
  const channel =
    asStr(pick(renderer, ["ownerText", "runs", 0, "text"])) ??
    asStr(pick(renderer, ["longBylineText", "runs", 0, "text"])) ??
    "";
  const lengthText =
    asStr(pick(renderer, ["lengthText", "simpleText"])) ?? "";
  const viewCountText =
    asStr(pick(renderer, ["viewCountText", "simpleText"])) ??
    asStr(pick(renderer, ["shortViewCountText", "simpleText"]));

  return {
    videoId,
    title,
    channel,
    durationSeconds: lengthText ? parseDurationText(lengthText) : null,
    viewCountText,
  };
};

export const makeYoutubeScraperClient = (): YouTubeScraperPort => ({
  fetchEgressIp: async () => {
    try {
      const res = await fetch("https://checkip.amazonaws.com", {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      const ip = (await res.text()).trim();
      return ip.length > 0 ? ip : null;
    } catch {
      return null;
    }
  },

  fetchWatchPage: async (videoId) => {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`,
      );
    } catch (e) {
      return err({
        kind: "HttpRequestFailed",
        detail: `watch page fetch failed: ${(e as Error).message}`,
      });
    }
    if (!res.ok) {
      return err({
        kind: "HttpRequestFailed",
        detail: `watch page HTTP ${res.status}`,
        httpStatus: res.status,
      });
    }

    const html = await res.text();
    const playerResponse = extractJsonAfter(html, "ytInitialPlayerResponse");
    if (!playerResponse) {
      return err({
        kind: "ParseFailed",
        detail:
          "ytInitialPlayerResponse not found in HTML (consent interstitial or bot wall)",
        httpStatus: res.status,
      });
    }

    const lengthText = asStr(pick(playerResponse, ["videoDetails", "lengthSeconds"]));
    return ok({
      playabilityStatus: asStr(pick(playerResponse, ["playabilityStatus", "status"])),
      playabilityReason: asStr(pick(playerResponse, ["playabilityStatus", "reason"])),
      title: asStr(pick(playerResponse, ["videoDetails", "title"])),
      durationSeconds:
        lengthText !== null && /^\d+$/.test(lengthText)
          ? Number.parseInt(lengthText, 10)
          : null,
      innertubeApiKey:
        html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? null,
      innertubeClientVersion:
        html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? null,
      captionTracks: parseCaptionTracks(playerResponse),
    });
  },

  searchYouTube: async (query, { innertubeApiKey, innertubeClientVersion }) => {
    const clientVersion = innertubeClientVersion ?? FALLBACK_CLIENT_VERSION;
    const keyParam = innertubeApiKey ? `&key=${innertubeApiKey}` : "";
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `https://www.youtube.com/youtubei/v1/search?prettyPrint=false${keyParam}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-youtube-client-name": "1",
            "x-youtube-client-version": clientVersion,
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "WEB",
                clientVersion,
                hl: "en",
                gl: "US",
              },
            },
            query,
          }),
        },
      );
    } catch (e) {
      return err({
        kind: "HttpRequestFailed",
        detail: `search fetch failed: ${(e as Error).message}`,
      });
    }
    if (!res.ok) {
      return err({
        kind: "HttpRequestFailed",
        detail: `search HTTP ${res.status}`,
        httpStatus: res.status,
      });
    }

    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      return err({
        kind: "ParseFailed",
        detail: "search response was not JSON",
        httpStatus: res.status,
      });
    }

    const renderers: unknown[] = [];
    collectVideoRenderers(pick(body, ["contents"]), renderers);
    const hits = renderers
      .map(mapSearchHit)
      .filter((hit): hit is YouTubeSearchHit => hit !== null);

    if (hits.length === 0) {
      const alerts = pick(body, ["alerts"]);
      const alertText = JSON.stringify(alerts) ?? "";
      return err({
        kind: "ParseFailed",
        detail: `no videoRenderer in search response${
          alertText.length > 2 ? `; alerts: ${alertText.slice(0, 300)}` : ""
        }`,
        httpStatus: res.status,
      });
    }
    return ok(hits);
  },

  fetchTranscript: async (videoId) => {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": ANDROID_UA },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "ANDROID",
                clientVersion: ANDROID_CLIENT_VERSION,
                androidSdkVersion: 30,
                hl: "en",
                gl: "US",
              },
            },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        },
      );
    } catch (e) {
      return err({
        kind: "HttpRequestFailed",
        detail: `player fetch failed: ${(e as Error).message}`,
      });
    }
    if (!res.ok) {
      return err({
        kind: "HttpRequestFailed",
        detail: `player HTTP ${res.status}`,
        httpStatus: res.status,
      });
    }

    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      return err({
        kind: "ParseFailed",
        detail: "player response was not JSON",
        httpStatus: res.status,
      });
    }

    const tracks = parseCaptionTracks(body);
    const track = pickPreferredTrack(tracks);
    if (!track) {
      return err({
        kind: "ParseFailed",
        detail: "player response exposed no caption tracks",
        httpStatus: res.status,
      });
    }

    let text: string;
    try {
      const timedtext = await fetchWithTimeout(track.baseUrl, {
        headers: { "user-agent": ANDROID_UA },
      });
      if (!timedtext.ok) {
        return err({
          kind: "HttpRequestFailed",
          detail: `timedtext HTTP ${timedtext.status}`,
          httpStatus: timedtext.status,
        });
      }
      text = await timedtext.text();
    } catch (e) {
      return err({
        kind: "HttpRequestFailed",
        detail: `timedtext fetch failed: ${(e as Error).message}`,
      });
    }

    const segments = parseTimedtextXml(text);
    if (segments.length === 0) {
      return err({
        kind: "ParseFailed",
        detail: "timedtext returned no usable segments",
        httpStatus: 200,
      });
    }
    return ok({
      language: track.languageCode,
      isAutoGenerated: track.isAutoGenerated,
      segments,
    });
  },
});