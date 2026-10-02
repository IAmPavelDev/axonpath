/**
 * One-shot Qdrant migration: copy every point from a source Qdrant (the EC2
 * Docker container) into a target (Qdrant Cloud free cluster). Preserves ids,
 * vectors, and payload exactly — point id = relational Vector row id, so the
 * relational metadata keeps matching after the cutover.
 *
 * Run from apps/backend (tsx + tsconfig-paths, same as the e2e harness):
 *   SOURCE_QDRANT_URL=http://localhost:6333 \
 *   TARGET_QDRANT_URL=https://xxxx.cloud.qdrant.io:6333 \
 *   TARGET_QDRANT_API_KEY=... \
 *   pnpm exec tsx --require tsconfig-paths/register qdrant-migrate.mts
 *
 * SOURCE_QDRANT_API_KEY is optional (local Qdrant has none); TARGET needs it.
 */
import qdrantClientModule from "@/modules/memory/infrastructure/qdrant.client.js";
import { QdrantClient } from "@qdrant/js-client-rest";

const { QDRANT_COLLECTION, VECTOR_DIM } = qdrantClientModule as {
  QDRANT_COLLECTION: string;
  VECTOR_DIM: number;
};

const BATCH = 256;

const sourceUrl = process.env.SOURCE_QDRANT_URL ?? "";
const targetUrl = process.env.TARGET_QDRANT_URL ?? "";
const targetApiKey = process.env.TARGET_QDRANT_API_KEY || undefined;
const sourceApiKey = process.env.SOURCE_QDRANT_API_KEY || undefined;

if (!sourceUrl || !targetUrl) {
  console.error(
    "SOURCE_QDRANT_URL and TARGET_QDRANT_URL are both required",
  );
  process.exit(1);
}

const source = new QdrantClient({ url: sourceUrl, apiKey: sourceApiKey });
const target = new QdrantClient({ url: targetUrl, apiKey: targetApiKey });

/** Same shape ensureCollection builds: 3072-dim cosine + filter indexes. */
const ensureTargetCollection = async (): Promise<void> => {
  const existing = await target.getCollections();
  if (existing.collections.some((c) => c.name === QDRANT_COLLECTION)) {
    return;
  }

  await target.createCollection(QDRANT_COLLECTION, {
    vectors: { size: VECTOR_DIM, distance: "Cosine" },
  });
  await target.createPayloadIndex(QDRANT_COLLECTION, {
    field_name: "userId",
    field_schema: "keyword",
    wait: true,
  });
  await target.createPayloadIndex(QDRANT_COLLECTION, {
    field_name: "skillId",
    field_schema: "keyword",
    wait: true,
  });
};

const sourceCount = async (): Promise<number> => {
  const info = await source.getCollection(QDRANT_COLLECTION);
  return info.points_count ?? 0;
};

await ensureTargetCollection();
const expected = await sourceCount();
console.log(`source has ${expected} points; migrating to ${targetUrl}`);

let offset: number | string | null | undefined;
let migrated = 0;
for (;;) {
  const page = await source.scroll(QDRANT_COLLECTION, {
    limit: BATCH,
    offset: offset ?? undefined,
    with_payload: true,
    with_vector: true,
  });
  if (page.points.length === 0) break;

  await target.upsert(QDRANT_COLLECTION, {
    wait: true,
    points: page.points.map((p) => ({
      id: p.id,
      vector: p.vector as number[],
      payload: p.payload ?? {},
    })),
  });
  migrated += page.points.length;
  console.log(`migrated ${migrated}/${expected}`);

  offset = page.next_page_offset;
  if (offset === null || offset === undefined) break;
}

if (migrated !== expected) {
  console.error(
    `MISMATCH: expected ${expected} points, migrated ${migrated} — investigate before cutting over`,
  );
  process.exit(1);
}
console.log(`done: ${migrated} points → ${targetUrl}`);
