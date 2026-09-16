import type { AiPort } from "@/modules/tutoring/ports";
import type { SearchSimilarHit, VectorStorePort } from "@/modules/memory/ports";

export type RetrieveRelevantContextDeps = {
  ai: Pick<AiPort, "generateEmbeddings">;
  vectorStore: VectorStorePort;
};

/**
 * Retrieval policy: embed the query, then pull the top-K most similar
 * context snippets for the user. Any failure (embedding or search) degrades
 * to "no personalization" — an empty list — never an error, so generation
 * always proceeds. `excludeSkillId` keeps a skill from retrieving its own
 * vectors back (topK 5, as in the original flow).
 */
export const makeRetrieveRelevantContext =
  ({ ai, vectorStore }: RetrieveRelevantContextDeps) =>
  async (input: {
    userId: number;
    query: string;
    topK?: number;
    excludeSkillId?: number;
  }): Promise<SearchSimilarHit[]> => {
    const embeddings = await ai.generateEmbeddings([input.query]);

    if (!embeddings.ok || embeddings.value.length === 0) {
      return [];
    }

    const hits = await vectorStore.searchSimilar({
      userId: input.userId,
      embedding: embeddings.value[0],
      topK: input.topK ?? 5,
      excludeSkillId: input.excludeSkillId,
    });

    return hits.ok ? hits.value : [];
  };
