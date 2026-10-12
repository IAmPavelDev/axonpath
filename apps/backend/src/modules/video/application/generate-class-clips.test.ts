import { describe, expect, it } from "vitest";

import {
  makeGenerateClassClips,
  type GenerateClassClipsDeps,
} from "@/modules/video/application/generate-class-clips";
import type { GeminiVideoClient } from "@/modules/video/infrastructure/gemini-video.client";
import type {
  NewClassClip,
  VideoRepository,
} from "@/modules/video/domain/video-repos";
import type { YouTubeScraperPort } from "@/modules/video/domain/youtube-access";
import type { AiPort } from "@/modules/tutoring/ports";
import { ok } from "@/modules/platform/result";

type Repo = Pick<
  VideoRepository,
  | "findClassForClips"
  | "setClipStatus"
  | "replaceClassClips"
  | "upsertVideoAsset"
>;

const CLASS_ROW = {
  id: 5,
  title: "Inner joins",
  contentMd: "# Inner joins\n\nA join matches rows...",
  skillTopic: "SQL joins",
};

const makeRepo = () => {
  const state = {
    clips: [] as NewClassClip[],
    finalStatus: null as string | null,
  };
  const repo = {
    findClassForClips: async () => CLASS_ROW,
    setClipStatus: async (_id: number, status: string) => {
      state.finalStatus = status;
    },
    replaceClassClips: async (_id: number, clips: NewClassClip[]) => {
      state.clips = clips;
    },
    upsertVideoAsset: async () => undefined,
  } satisfies Repo;
  // Partial fake: only the members the use case touches; the rest throws.
  return { repo: repo as unknown as VideoRepository, state };
};

const makeAi = (response: string): Pick<AiPort, "generateJson"> => ({
  generateJson: async () => ok({ raw: response }),
});

const makeSearch = (): Pick<YouTubeScraperPort, "searchYouTube"> => ({
  searchYouTube: async () => ({
    ok: true,
    value: [
      {
        videoId: "aaa11111111",
        title: "SQL joins visualized",
        channel: "Edu",
        durationSeconds: 900,
        viewCountText: "1M views",
      },
    ],
  }),
});

const makeGemini = (
  result: { found: true; startSeconds: number; endSeconds: number; summary: string } | { found: false } | { error: true },
): GeminiVideoClient => ({
  selectClipSegment: async () =>
    "error" in result
      ? { ok: false, error: { kind: "HttpRequestFailed", detail: "down" } }
      : ok(result),
});

const makeDeps = (
  repo: VideoRepository,
  gemini: GeminiVideoClient,
  aiResponse = '{"helps":true,"concepts":[{"query":"sql inner joins explained","anchorParagraph":1}]}',
): GenerateClassClipsDeps => ({
  videoRepo: repo,
  search: makeSearch(),
  ai: makeAi(aiResponse),
  gemini,
});

describe("makeGenerateClassClips", () => {
  it("selects a clamped clip and flips the class READY", async () => {
    const { repo, state } = makeRepo();
    await makeGenerateClassClips(
      makeDeps(repo, makeGemini({ found: true, startSeconds: 120, endSeconds: 400, summary: "joins" })),
    )({ classId: 5 });
    expect(state.finalStatus).toBe("READY");
    expect(state.clips).toHaveLength(1);
    expect(state.clips[0]).toMatchObject({
      anchorParagraph: 1,
      videoId: "aaa11111111",
      startSeconds: 120,
      endSeconds: 400,
    });
  });

  it("skips silently when the model says videos would not help", async () => {
    const { repo, state } = makeRepo();
    await makeGenerateClassClips(
      makeDeps(repo, makeGemini({ found: false }), '{"helps":false,"concepts":[]}'),
    )({ classId: 5 });
    expect(state.finalStatus).toBe("SKIPPED");
    expect(state.clips).toEqual([]);
  });

  it("stays PENDING when search and Gemini both fail (sweeper retries)", async () => {
    const { repo, state } = makeRepo();
    await makeGenerateClassClips(
      makeDeps(repo, makeGemini({ error: true })),
    )({ classId: 5 });
    expect(state.finalStatus).toBeNull();
    expect(state.clips).toEqual([]);
  });
});
