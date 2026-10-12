import { describe, expect, it } from "vitest";

import {
  clampClipWindow,
  parseViewCount,
  rankCandidates,
} from "@/modules/video/domain/video-enrichment";
import { parseClipSelection } from "@/modules/video/infrastructure/gemini-video.client";
import { parseSkipSegments } from "@/modules/video/infrastructure/sponsor.client";
import { parseTimedtextXml } from "@/modules/video/infrastructure/youtube-scraper.client";
import type { YouTubeSearchHit } from "@/modules/video/domain/youtube-access";

const hit = (over: Partial<YouTubeSearchHit>): YouTubeSearchHit => ({
  videoId: "abc12345678",
  title: "JavaScript closures explained",
  channel: "Edu",
  durationSeconds: 600,
  viewCountText: "100K views",
  ...over,
});

describe("parseViewCount", () => {
  it("parses plain, thousands and millions", () => {
    expect(parseViewCount("424,284 views")).toBe(424284);
    expect(parseViewCount("1.1M views")).toBe(1_100_000);
    expect(parseViewCount("2B views")).toBe(2_000_000_000);
    expect(parseViewCount("No views")).toBeNull();
    expect(parseViewCount(null)).toBeNull();
  });
});

describe("rankCandidates", () => {
  it("ranks sane-duration, on-topic, popular videos above noise", () => {
    const ranked = rankCandidates(
      [
        hit({ videoId: "short000001", durationSeconds: 45 }),
        hit({ videoId: "good0000001", durationSeconds: 900, viewCountText: "5M views" }),
        hit({ videoId: "offtopic0001", title: "Cooking pasta basics", viewCountText: "10 views" }),
        hit({ videoId: "podcast0001", durationSeconds: 14400 }),
      ],
      "javascript closures",
      10,
    );
    expect(ranked[0]?.hit.videoId).toBe("good0000001");
    expect(ranked[ranked.length - 1]?.hit.videoId).toBe("offtopic0001");
    const byId = new Map(ranked.map((entry) => [entry.hit.videoId, entry.score]));
    const good = byId.get("good0000001") ?? 0;
    expect(good).toBeGreaterThan(byId.get("short000001") ?? 0);
    expect(good).toBeGreaterThan(byId.get("podcast0001") ?? 0);
  });
});

describe("clampClipWindow", () => {
  it("widens short windows backwards first", () => {
    expect(clampClipWindow(10, 25, 600)).toEqual({ startSeconds: 5, endSeconds: 30 });
    expect(clampClipWindow(5, 8, 600)).toEqual({ startSeconds: 0, endSeconds: 25 });
  });

  it("caps at 8 minutes inside the video", () => {
    expect(clampClipWindow(100, 2000, 600)).toEqual({ startSeconds: 100, endSeconds: 580 });
  });

  it("grows a zero window at the video start to the floor", () => {
    expect(clampClipWindow(0, 0, 600)).toEqual({ startSeconds: 0, endSeconds: 20 });
  });
});

describe("parseClipSelection", () => {
  it("parses a found segment and propagates found=false", () => {
    expect(
      parseClipSelection('{"found":true,"startSeconds":120,"endSeconds":300,"summary":"closures"}'),
    ).toEqual({
      ok: true,
      value: { found: true, startSeconds: 120, endSeconds: 300, summary: "closures" },
    });
    expect(parseClipSelection('{"found":false}')).toEqual({ ok: true, value: { found: false } });
    expect(parseClipSelection("no json here").ok).toBe(false);
  });
});

describe("parseTimedtextXml", () => {
  it("parses srv3 paragraphs with entities into segments", () => {
    const xml =
      '<timedtext format="3"><body><p t="1200" d="3400"><s>a &#39;quoted&#39;</s><s> text</s></p>' +
      '<p t="5000" d="1000"><s>&amp; more</s></p></body></timedtext>';
    expect(parseTimedtextXml(xml)).toEqual([
      { startSeconds: 1.2, endSeconds: 4.6, text: "a 'quoted' text" },
      { startSeconds: 5, endSeconds: 6, text: "& more" },
    ]);
  });
});

describe("parseSkipSegments", () => {
  it("keeps valid sponsor segments and drops malformed entries", () => {
    expect(
      parseSkipSegments([
        { segment: [10, 45.5], category: "sponsor" },
        { segment: [1], category: "sponsor" },
        { segment: [3, 3.2], category: "selfpromo" },
        "garbage",
      ]),
    ).toEqual([{ startSeconds: 10, endSeconds: 45.5, category: "sponsor" }]);
  });
});
