import type { AiPort } from "@/modules/tutoring/ports";
import type { SearchSimilarHit, VectorStorePort } from "@/modules/memory/ports";

/** Degrade value: QA assembly skips the memory layer when this comes back empty. */
export type QaContextHits = {
  /** This skill's own memory: CONTENT_CHUNK + AI_NEXT + ANSWER_DERIVED + QA_DERIVED. */
  skillHits: SearchSimilarHit[];
  /** Cross-skill personal context (AI_INITIAL notes from other skills, etc.). */
  crossHits: SearchSimilarHit[];
};

export type RetrieveQaContextDeps = {
  ai: Pick<AiPort, "generateEmbeddings">;
  vectorStore: VectorStorePort;
};

export type RetrieveQaContext = (input: {
  userId: number;
  skillId: number;
  query: string;
}) => Promise<QaContextHits>;

/**
 * QA retrieval (Phase 8 D4): ONE query embedding of the question + selection,
 * two filtered searches — this skill's memory (positive `skillId` filter) and
 * the learner's cross-skill personal context (`excludeSkillId`). Any failure
 * degrades to empty lists, never an error: memory is never load-bearing.
 */
export const makeRetrieveQaContext =
  ({ ai, vectorStore }: RetrieveQaContextDeps): RetrieveQaContext =>
  async (input) => {
    const embeddings = await ai.generateEmbeddings([input.query]);
    if (!embeddings.ok || embeddings.value.embeddings.length === 0) {
      return { skillHits: [], crossHits: [] };
    }

    const embedding = embeddings.value.embeddings[0];
    const [skill, cross] = await Promise.all([
      vectorStore.searchSimilar({
        userId: input.userId,
        skillId: input.skillId,
        embedding,
        topK: 6,
      }),
      vectorStore.searchSimilar({
        userId: input.userId,
        excludeSkillId: input.skillId,
        embedding,
        topK: 4,
      }),
    ]);

    return {
      skillHits: skill.ok ? skill.value : [],
      crossHits: cross.ok ? cross.value : [],
    };
  };
