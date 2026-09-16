import type { NewVector, VectorStorePort } from "@/modules/memory/ports";

export type RecordVectorsDeps = { vectorStore: VectorStorePort };

/** Record context snippets as user memory. Vectors are never load-bearing for
 * the request path: failures return err and callers decide (init flow logs
 * and continues, mirroring the old controller behavior). */
export const makeRecordVectors =
  ({ vectorStore }: RecordVectorsDeps) =>
  (vectors: NewVector[]) =>
    vectorStore.upsert(vectors);
