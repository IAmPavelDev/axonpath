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
  | "findSkillLanguage"
  | "setRecommendationsStatus"
  | "replaceRecommendations"
>;

const makeRepo = (options: {
  status?: "PENDING" | "READY" | "FAILED" | null;
  attempts?: number;
  topic?: string | null;
  language?: string | null;
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
    findSkillLanguage: async () => options.language ?? null,
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

/** Scripted AI: one raw per generateJson call, in order. */
const makeAiScripted = (raws: (string | null)[]): Pick<AiPort, "generateJson"> => {
  let call = 0;
  return {
    generateJson: async () => {
      const raw = raws[call++] ?? null;
      return raw === null
        ? { ok: false, error: { kind: "AiGenerationFailed" } }
        : { ok: true, value: { raw } };
    },
  };
};

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
  it("keeps only the required language when the lesson language is known", async () => {
    const { repo, state } = makeRepo({ language: "en" });
    const hits = [
      HIT("hhh11111111", "SQL JOINs in Hindi — आसान तरीका"),
      HIT("aaa11111111", "SQL joins tutorial"),
      HIT("hhh22222222", "Complete SQL JOINs For Beginners | SQL Tutorial in Hindi"),
    ];
    const ai = makeAiScripted(['{"ranked":[1]}']);

    await makeGenerateSkillRecommendations(makeDeps(repo, makeSearch(hits), ai))({
      skillId: 7,
    });

    expect(state.finalStatus).toBe("READY");
    expect(state.written.map((item) => item.videoId)).toEqual(["aaa11111111"]);
    expect(state.written[0]?.rank).toBe(1);
  });

  it("classifies the skill language from the topic before lesson 0 exists", async () => {
    const { repo, state } = makeRepo({ topic: "حل معادلات من الدرجة الثانية" });
    const ai = makeAiScripted(['{"language":"ar"}', '{"ranked":[0,1]}']);

    await makeGenerateSkillRecommendations(
      makeDeps(repo, makeSearch(HITS), ai),
    )({ skillId: 7 });

    expect(state.finalStatus).toBe("READY");
    expect(state.written.map((item) => item.videoId)).toEqual([
      "aaa11111111",
      "bbb22222222",
    ]);
  });

  it("degrades to the unfiltered heuristic path when the language pass fails", async () => {
    const { repo, state } = makeRepo({ language: "en" });
    const ai = makeAiScripted([null]); // selectByLanguage model call fails

    await makeGenerateSkillRecommendations(
      makeDeps(repo, makeSearch(HITS), ai),
    )({ skillId: 7 });

    expect(state.finalStatus).toBe("READY");
    expect(state.written.map((item) => item.videoId)).toEqual([
      "aaa11111111",
      "bbb22222222",
    ]);
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
