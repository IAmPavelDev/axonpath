import type {
  ClassContentVectorsJobPayload,
  VectorizeClassContent,
} from "@/modules/memory/application/vectorize-class-content";

/**
 * The instant trigger for class-content vectorization. The vectorizer owns
 * its degrade policy internally — every failure path (dedup read, class load,
 * embeddings, record) resolves to ok with nothing recorded — so there is
 * deliberately no error logging here; a silent no-op IS the correct outcome.
 */
export const getVectorizeClassContentJobHandler = (
  vectorizeClassContent: VectorizeClassContent,
) => {
  return async (payload: ClassContentVectorsJobPayload) => {
    await vectorizeClassContent(payload);
  };
};
