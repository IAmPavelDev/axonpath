import { err, ok, type Result } from "@/modules/platform/result";
import type { ClipSelection } from "@/modules/video/domain/video-enrichment";

/**
 * Gemini video-understanding client — the sanctioned transcript path. Google
 * ingests the public YouTube URL server-side (no bot wall applies to it; the
 * 2026-10-12 probe's scraping paths are dead from Lambda IPs). One static
 * pass returns a bounded, JSON-mode answer: the timestamped segment that
 * fully explains the concept, or found=false.
 */
export type GeminiVideoClient = {
  selectClipSegment(input: {
    videoId: string;
    concept: string;
    lessonTitle: string;
  }): Promise<Result<ClipSelection, GeminiVideoError>>;
};

export type GeminiVideoError = {
  kind: "HttpRequestFailed" | "ParseFailed" | "NotFound";
  detail: string;
  httpStatus?: number;
};

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 120_000; // static video passes run 30–90 s on 10-min clips

export const VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL ?? "gemini-2.5-flash";

export const buildClipSelectionPrompt = (concept: string, lessonTitle: string): string =>
  [
    `You are selecting the exact segment of this YouTube video that teaches: "${concept}"`,
    `It will be embedded inside a lesson titled "${lessonTitle}".`,
    "Rules:",
    "- The segment must contain a complete explanation, from the first sentence",
    "  of the explanation through the end of its example or demonstration.",
    "- Skip intros, channel branding, sponsorships and unrelated topics.",
    "- Prefer a segment between 1 and 6 minutes.",
    '- Answer ONLY with JSON: {"found": boolean, "startSeconds": number, "endSeconds": number, "summary": string}',
    '- "found" is false when the video does not actually explain the concept.',
  ].join("\n");

/** Defensive parse of the JSON-mode body; Gemini may still wrap or omit. */
export const parseClipSelection = (raw: string): Result<ClipSelection, GeminiVideoError> => {
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return err({ kind: "ParseFailed", detail: "no JSON object in model output" });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
  } catch {
    return err({ kind: "ParseFailed", detail: "model output was not parseable JSON" });
  }
  const found = parsed.found === true;
  if (!found) return ok({ found: false });
  const startSeconds = Number(parsed.startSeconds);
  const endSeconds = Number(parsed.endSeconds);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    return err({ kind: "ParseFailed", detail: "clip bounds missing or non-numeric" });
  }
  return ok({
    found: true,
    startSeconds,
    endSeconds,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  });
};

export const makeGeminiVideoClient = (apiKey: string): GeminiVideoClient => ({
  selectClipSegment: async ({ videoId, concept, lessonTitle }) => {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${VIDEO_MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: buildClipSelectionPrompt(concept, lessonTitle) },
                { file_data: { file_uri: `https://www.youtube.com/watch?v=${videoId}` } },
              ],
            },
          ],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      });
    } catch (e) {
      return err({ kind: "HttpRequestFailed", detail: (e as Error).message });
    }
    if (res.status === 404) {
      return err({
        kind: "NotFound",
        detail: "video not ingestible (private, removed or region-locked)",
        httpStatus: 404,
      });
    }
    if (!res.ok) {
      return err({
        kind: "HttpRequestFailed",
        detail: `gemini HTTP ${res.status}`,
        httpStatus: res.status,
      });
    }
    let text: string;
    try {
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    } catch {
      return err({ kind: "ParseFailed", detail: "gemini response was not JSON" });
    }
    return parseClipSelection(text);
  },
});
