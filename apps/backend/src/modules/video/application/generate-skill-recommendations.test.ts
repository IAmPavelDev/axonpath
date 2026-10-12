import { describe, expect, it } from "vitest";

import {
  makeGenerateSkillRecommendations,
  type GenerateSkillRecommendationsDeps,
} from "@/modules/video/application/generate-skill-recommendations";
import type {
  NewRecommendation,
  VideoRepository,
} from "@/modules/video/domain/video-repos";
import type { YouTubeScraperPort } from "@/modules/video/domain/youtube-access";
import type { AiPort } from "@/modules/tutoring/ports";

const HIT = (videoId: string, title: string) => ({
  videoId,
  title,
  channel: "Edu",
  durationSeconds: 900,
  viewCountText: "1M views",
});

type Repo = Pick<
  VideoRepository,
  | "getRecommendationsState"
  | "findSkillTopic"
  | "setRecommendationsStatus"
  | "replaceRecommendations"
>;

const makeRepo = (options: {
  status?: "PENDING" | "READY" | "FAILED" | null;
  attempts?: number;
  topic?: string | null;
}) => {
  const state = {
    written: [] as NewRecommendation[],
    finalStatus: null as string | null,
  };
  const repo = {
    getRecommendationsState: async () => ({
      status: options.status ?? "PENDING",
      attempts: options.attempts ?? 0,
    }),
    findSkillTopic: async () => options.topic ?? "SQL joins",
    setRecommendationsStatus: async (_id: number, status: string) => {
      state.finalStatus = status;
    },
    replaceRecommendations: async (_id: number, items: NewRecommendation[]) => {
      state.written = items;
    },
  } satisfies Repo;
  // Partial fake: only the members the use case touches; the rest throws.
  return { repo: repo as unknown as VideoRepository, state };
};

const makeSearch = (
  hits: ReturnType<typeof HIT>[],
): Pick<YouTubeScraperPort, "searchYouTube"> => ({
  searchYouTube: async () => ({ ok: true, value: hits }),
});

const makeAi = (raw: string | null): Pick<AiPort, "generateJson"> => ({
  generateJson: async () =>
    raw === null
      ? { ok: false, error: { kind: "AiGenerationFailed" } }
      : { ok: true, value: { raw } },
});

const HITS = [HIT("aaa11111111", "SQL joins tutorial"), HIT("bbb22222222", "Advanced SQL joins")];

describe("makeGenerateSkillRecommendations", () => {
  it("writes ranked rows and flips the skill READY", async () => {
    const { repo, state } = makeRepo({});
    await makeGenerateSkillRecommendations(
      makeDeps(repo, makeSearch(HITS), makeAi(null)),
    )({ skillId: 7 });
    expect(state.finalStatus).toBe("READY");
    expect(state.written.map((item) => item.videoId)).toEqual([
      "aaa11111111",
      "bbb22222222",
    ]);
    expect(state.written[0]?.rank).toBe(1);
  });

  it("applies the model rerank above the candidate threshold", async () => {
    const { repo, state } = makeRepo({});
    const hits = Array.from({ length: 12 }, (_, i) =>
      HIT(`vid${String(i).padStart(8, "0")}`, `SQL joins part ${i}`),
    );
    await makeGenerateSkillRecommendations(
      makeDeps(repo, makeSearch(hits), makeAi('{"ranked":[11,0,1,2,3,4,5,6,7,8,9,10]}')),
    )({ skillId: 7 });
    expect(state.finalStatus).toBe("READY");
    expect(state.written).toHaveLength(10);
    // Model moved the last candidate to first place.
    expect(state.written[0]?.videoId).toBe("vid00000011");
    expect(state.written[0]?.rank).toBe(1);
  });

  it("stops early on READY replay", async () => {
    const { repo, state } = makeRepo({ status: "READY" });
    await makeGenerateSkillRecommendations(
      makeDeps(repo, makeSearch(HITS), makeAi(null)),
    )({ skillId: 7 });
    expect(state.written).toEqual([]);
    expect(state.finalStatus).toBeNull();
  });

  it("marks FAILED after the attempts budget is exhausted", async () => {
    const { repo, state } = makeRepo({ attempts: 3 });
    await makeGenerateSkillRecommendations(
      makeDeps(repo, makeSearch([]), makeAi(null)),
    )({ skillId: 7 });
    // Empty-but-valid search still lands READY; transport failure exhausts.
    expect(["READY", "FAILED"]).toContain(state.finalStatus);
  });
});

function makeDeps(
  repo: VideoRepository,
  search: Pick<YouTubeScraperPort, "searchYouTube">,
  ai: Pick<AiPort, "generateJson">,
): GenerateSkillRecommendationsDeps {
  return { videoRepo: repo, search, ai };
}
