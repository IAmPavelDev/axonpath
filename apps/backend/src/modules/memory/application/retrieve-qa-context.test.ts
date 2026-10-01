import { describe, expect, it } from "vitest";
import {
  makeRetrieveQaContext,
  type RetrieveQaContextDeps,
} from "./retrieve-qa-context";
import { err, ok } from "@/modules/platform/result";
import type { SearchSimilarHit, VectorStorePort } from "@/modules/memory/ports";
import type { AiPort } from "@/modules/tutoring/ports";

const hit = (id: number, snippet: string): SearchSimilarHit => ({
  vectorId: id,
  score: 0.9,
  textSnippet: snippet,
  source: "CONTENT_CHUNK",
  classIndex: null,
  tokenCount: null,
});

/** Test seam: scriptable search results/failures, capturing the filters used. */
const makeFakeDeps = (options: {
  embeddingsFail?: boolean;
  skillSearch?: { ok: true; value: SearchSimilarHit[] } | { ok: false; error: { kind: "VectorStoreUnavailable" } };
  crossSearch?: { ok: true; value: SearchSimilarHit[] } | { ok: false; error: { kind: "VectorStoreUnavailable" } };
} = {}) => {
  const calls: { topK?: number; skillId?: number; excludeSkillId?: number }[] = [];

  const ai: Pick<AiPort, "generateEmbeddings"> = {
    generateEmbeddings: async (content) =>
      options.embeddingsFail
        ? err({ kind: "AiGenerationFailed", detail: "embeddings down" })
        : ok({ embeddings: content.map(() => [0.1, 0.2, 0.3]) }),
  };
  const vectorStore: VectorStorePort = {
    upsert: async () => ok([]),
    searchSimilar: async (input) => {
      calls.push({ topK: input.topK, skillId: input.skillId, excludeSkillId: input.excludeSkillId });
      if (input.skillId !== undefined) {
        return options.skillSearch ?? ok([]);
      }
      return options.crossSearch ?? ok([]);
    },
  };

  const deps: RetrieveQaContextDeps = { ai, vectorStore };
  return { deps, calls };
};

describe("makeRetrieveQaContext", () => {
  it("issues one skill-scoped and one cross-skill search with the same embedding", async () => {
    const { deps, calls } = makeFakeDeps({
      skillSearch: { ok: true, value: [hit(1, "chunk about joins")] },
      crossSearch: { ok: true, value: [hit(2, "note from another skill")] },
    });

    const hits = await makeRetrieveQaContext(deps)({
      userId: 7,
      skillId: 10,
      query: "left joins\na left join keeps every left row",
    });

    expect(hits.skillHits.map((h) => h.textSnippet)).toEqual(["chunk about joins"]);
    expect(hits.crossHits.map((h) => h.textSnippet)).toEqual(["note from another skill"]);
    expect(calls).toEqual([
      { topK: 6, skillId: 10, excludeSkillId: undefined },
      { topK: 4, skillId: undefined, excludeSkillId: 10 },
    ]);
  });

  it("degrades to empty lists when the query embedding fails", async () => {
    const { deps, calls } = makeFakeDeps({ embeddingsFail: true });

    const hits = await makeRetrieveQaContext(deps)({ userId: 7, skillId: 10, query: "q" });

    expect(hits).toEqual({ skillHits: [], crossHits: [] });
    expect(calls).toHaveLength(0);
  });

  it("degrades each search group independently on failure", async () => {
    const { deps } = makeFakeDeps({
      skillSearch: { ok: false, error: { kind: "VectorStoreUnavailable" } },
      crossSearch: { ok: true, value: [hit(2, "note")] },
    });

    const hits = await makeRetrieveQaContext(deps)({ userId: 7, skillId: 10, query: "q" });

    expect(hits.skillHits).toEqual([]);
    expect(hits.crossHits.map((h) => h.textSnippet)).toEqual(["note"]);
  });
});
