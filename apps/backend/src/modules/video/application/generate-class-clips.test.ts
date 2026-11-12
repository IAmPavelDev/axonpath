import { describe, expect, it, beforeEach } from "vitest";

import {
  makeGenerateClassClips,
  CLASS_VIDEO_CLIPS_JOB,
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
  | "bumpClipAttempts"
  | "replaceClassClips"
  | "upsertVideoAsset"
>;

const CLASS_ROW: {
  id: number;
  title: string;
  contentMd: string;
  skillTopic: string;
  baseLanguage: string | null;
} = {
  id: 5,
  title: "Inner joins",
  contentMd: "# Inner joins\n\nA join matches rows...",
  skillTopic: "SQL joins",
  baseLanguage: null,
};
const makeRepo = (klass: typeof CLASS_ROW = CLASS_ROW) => {
  const state = {
    clips: [] as NewClassClip[],
    finalStatus: null as string | null,
    attempts: 0,
  };
  const repo = {
    findClassForClips: async () => klass,
    setClipStatus: async (_id: number, status: string) => {
      state.finalStatus = status;
    },
    bumpClipAttempts: async () => {
      state.attempts += 1;
      return state.attempts;
    },
    replaceClassClips: async (_id: number, clips: NewClassClip[]) => {
      state.clips = clips;
    },
    upsertVideoAsset: async () => undefined,
  } satisfies Repo;
  // Partial fake: only the members the use case touches; the rest throws.
  return { repo: repo as unknown as VideoRepository, state };
};

const makeAi = (response: string) => {
  const prompts: string[] = [];
  const ai: Pick<AiPort, "generateJson"> = {
    generateJson: async (input) => {
      prompts.push(input.prompt);
      return ok({ raw: response });
    },
  };
  return { ai, prompts };
};

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
  result:
    | { found: true; startSeconds: number; endSeconds: number; summary: string }
    | { found: false }
    | { error: true; httpStatus?: number },
) => {
  const inputs: Parameters<GeminiVideoClient["selectClipSegment"]>[0][] = [];
  const gemini: GeminiVideoClient = {
    selectClipSegment: async (input) => {
      inputs.push(input);
      return "error" in result
        ? {
            ok: false,
            error: {
              kind: "HttpRequestFailed" as const,
              detail: "down",
              httpStatus: result.httpStatus,
            },
          }
        : ok(result);
    },
  };
  return { gemini, inputs };
};

const DEFAULT_PLAN =
  '{"helps":true,"concepts":[{"query":"sql inner joins explained","anchorParagraph":1}]}';

const enqueued: Array<{ jobName: string; payload: unknown }> = [];

const makeDeps = (
  repo: VideoRepository,
  gemini: GeminiVideoClient,
  ai: Pick<AiPort, "generateJson"> = makeAi(DEFAULT_PLAN).ai,
): GenerateClassClipsDeps => ({
  videoRepo: repo,
  search: makeSearch(),
  ai,
  gemini,
  jobs: {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  },
});

describe("makeGenerateClassClips", () => {
  beforeEach(() => {
    enqueued.length = 0;
  });
  it("selects a clamped clip and flips the class READY", async () => {
    const { repo, state } = makeRepo();
    const { gemini } = makeGemini({ found: true, startSeconds: 120, endSeconds: 400, summary: "joins" });
    await makeGenerateClassClips(makeDeps(repo, gemini))({ classId: 5 });
    expect(state.finalStatus).toBe("READY");
    expect(state.clips).toHaveLength(1);
    expect(state.clips[0]).toMatchObject({
      anchorParagraph: 1,
      videoId: "aaa11111111",
      startSeconds: 120,
      endSeconds: 400,
    });
  });

  it("passes the lesson language into the plan prompt and the clip selector", async () => {
    const { repo, state } = makeRepo({ ...CLASS_ROW, baseLanguage: "en" });
    const { ai, prompts } = makeAi(DEFAULT_PLAN);
    const { gemini, inputs } = makeGemini({ found: true, startSeconds: 120, endSeconds: 400, summary: "joins" });

    await makeGenerateClassClips(makeDeps(repo, gemini, ai))({ classId: 5 });

    expect(prompts[0]).toContain("en (BCP-47)");
    expect(inputs[0]).toMatchObject({ videoId: "aaa11111111", language: "en" });
    expect(state.finalStatus).toBe("READY");
  });

  it("skips silently when the model says videos would not help", async () => {
    const { repo, state } = makeRepo();
    const { gemini } = makeGemini({ found: false });
    await makeGenerateClassClips(
      makeDeps(repo, gemini, makeAi('{"helps":false,"concepts":[]}').ai),
    )({ classId: 5 });
    expect(state.finalStatus).toBe("SKIPPED");
    expect(state.clips).toEqual([]);
  });

  it("stays PENDING when search and Gemini both fail (sweeper retries)", async () => {
    const { repo, state } = makeRepo();
    const { gemini } = makeGemini({ error: true });
    await makeGenerateClassClips(makeDeps(repo, gemini))({ classId: 5 });
    expect(state.finalStatus).toBeNull();
    expect(state.clips).toEqual([]);
  });

  it("requeues immediately on a Gemini 5xx instead of idling the lease", async () => {
    const { repo, state } = makeRepo();
    const { gemini } = makeGemini({ error: true, httpStatus: 503 });
    await makeGenerateClassClips(makeDeps(repo, gemini))({ classId: 5 });

    expect(state.attempts).toBe(1);
    expect(state.finalStatus).toBeNull();
    expect(enqueued).toEqual([
      { jobName: CLASS_VIDEO_CLIPS_JOB, payload: { classId: 5 } },
    ]);
  });

  it("flips SKIPPED without requeue once the attempts budget is exhausted", async () => {
    const { repo, state } = makeRepo();
    const { gemini } = makeGemini({ error: true, httpStatus: 503 });
    const run = makeGenerateClassClips(makeDeps(repo, gemini));

    await run({ classId: 5 }); // attempt 1 → requeue
    await run({ classId: 5 }); // attempt 2 → requeue
    enqueued.length = 0;
    await run({ classId: 5 }); // attempt 3 → budget spent

    expect(state.attempts).toBe(3);
    expect(state.finalStatus).toBe("SKIPPED");
    expect(enqueued).toEqual([]);
  });
});
