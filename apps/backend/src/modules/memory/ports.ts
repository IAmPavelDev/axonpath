import type { VectorSource } from "@/prisma/generated";
import type { Result } from "@/modules/platform/result";
/**
 * Memory context — the per-user vector store of atomic context snippets.
 * A snippet is a short self-contained fact about the user, embedded and
 * retrieved individually to personalize AI generation.
 */
export type NewVector = {
  skillId: number;
  userId: number;
  classId?: number | null;
  embedding: number[];
  source: VectorSource;
  textSnippet: string;
  classIndex?: number | null;
  tokenCount?: number | null;
  /** Set when the snippet was mined from a recorded answer (ANSWER_DERIVED). */
  answerId?: number | null;
};

/**
 * Read-side over the relational Vector metadata alone (no Qdrant). Exists so
 * background memory jobs can consult "what is already stored" without
 * touching the embedding store.
 */
export type VectorMetadataRepository = {
  /** Which of the given answer ids already have at least one vector. */
  findAnswerIdsWithVectors(answerIds: number[]): Promise<Result<number[], VectorStoreError>>;
  /**
   * Embedding-spend aggregate behind usage.report: SUM(Vector.tokenCount)
   * for one user (optionally one skill). tokenCount is null on capture-degrade
   * paths; those vectors are counted in nullCount, never guessed.
   */
  sumTokenCountsByUser(
    userId: number,
    skillId?: number,
  ): Promise<{ totalTokens: number; nullCount: number }>;
};

export type SearchSimilarHit = {
  vectorId: number;
  score: number;
  textSnippet: string;
  source: VectorSource;
  classIndex: number | null;
  tokenCount: number | null;
};

export type VectorStoreError = {
  kind: "VectorStoreUnavailable";
  detail?: string;
} | {
  kind: "VectorUpsertFailed";
  detail?: string;
};

export type VectorStorePort = {
  /** Persist Vector metadata rows + upsert embeddings; returns row ids in input order. */
  upsert(vectors: NewVector[]): Promise<Result<number[], VectorStoreError>>;
  /** Semantic search over a user's vectors, filtered to that user. */
  searchSimilar(input: {
    userId: number;
    embedding: number[];
    topK?: number;
    excludeSkillId?: number;
  }): Promise<Result<SearchSimilarHit[], VectorStoreError>>;
};

