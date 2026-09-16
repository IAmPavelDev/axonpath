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

