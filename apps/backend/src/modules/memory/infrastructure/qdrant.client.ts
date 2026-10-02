import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "@/modules/platform/config";

/** gemini-embedding-2 output dimensionality. */
export const VECTOR_DIM = 3072;
export const QDRANT_COLLECTION = "axon_vectors";

let client: QdrantClient | null = null;
let collectionReady: Promise<void> | null = null;

export const getQdrantClient = (): QdrantClient => {
  if (!client) {
    client = new QdrantClient({
      url: config.qdrant.url,
      apiKey: config.qdrant.apiKey || undefined,
    });
  }
  return client;
};

const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

/**
 * Ensures the Qdrant collection exists, creating it (with payload indexes on
 * `userId` and `skillId` for filtered retrieval) on first use. Idempotent
 * across calls.
 */
export const ensureCollection = async (): Promise<void> => {
  if (!collectionReady) {
    collectionReady = (async () => {
      const qdrant = getQdrantClient();
      const existing = await qdrant.getCollections();
      const present = existing.collections.some(
        (col) => col.name === QDRANT_COLLECTION
      );
      if (present) {
        return;
      }

      await qdrant.createCollection(QDRANT_COLLECTION, {
        vectors: { size: VECTOR_DIM, distance: "Cosine" },
      });

      // Collection creation is async; wait until it is queryable before indexing.
      for (let attempt = 0; attempt < 20; attempt++) {
        const listed = await qdrant.getCollections();
        if (listed.collections.some((col) => col.name === QDRANT_COLLECTION)) {
          break;
        }
        await sleep(200);
      }

      await qdrant.createPayloadIndex(QDRANT_COLLECTION, {
        field_name: "userId",
        field_schema: "keyword",
        wait: true,
      });
      await qdrant.createPayloadIndex(QDRANT_COLLECTION, {
        field_name: "skillId",
        field_schema: "keyword",
        wait: true,
      });
    })();
  }
  await collectionReady;
};
