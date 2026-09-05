import { prisma } from "@/prisma";
import { Prisma } from "@/prisma/generated/client";
import { VectorSource } from "@/prisma/generated";
import { CreateVectorsInputDto } from "./dto/CreateVector.dto";
import {
  ensureCollection,
  getQdrantClient,
  QDRANT_COLLECTION,
} from "./qdrant.ts";

export interface SearchSimilarInput {
  userId: number;
  embedding: number[];
  topK?: number;
  excludeSkillId?: number;
}

export interface SearchSimilarHit {
  vectorId: number;
  score: number;
  textSnippet: string;
  source: VectorSource;
  classIndex: number | null;
  tokenCount: number | null;
}

/**
 * Persists vector metadata as a relational `Vector` row and upserts the
 * embedding into Qdrant (point id = the relational row id).
 * Returns the created vector ids.
 */
const createVectors = async (
  input: CreateVectorsInputDto,
): Promise<number[]> => {
  if (input.vectors.length === 0) {
    return [];
  }

  await ensureCollection();

  const tuples = input.vectors.map((vector) =>
    Prisma.sql`(
      ${vector.skillId},
      ${vector.classId ?? null},
      ${vector.source}::"VectorSource",
      ${vector.textSnippet},
      ${vector.classIndex ?? null},
      ${vector.tokenCount ?? null}
    )`,
  );

  const values = Prisma.join(tuples);

  const rows = await prisma.$queryRaw<{ id: number }[]>`
    INSERT INTO "Vector" (
      "skillId",
      "classId",
      "source",
      "textSnippet",
      "classIndex",
      "tokenCount"
    ) VALUES ${values}
    RETURNING "id";
  `;

  const vectorIds = rows.map((row) => row.id);

  await getQdrantClient().upsert(QDRANT_COLLECTION, {
    wait: true,
    points: input.vectors.map((vector, i) => ({
      id: vectorIds[i],
      vector: vector.embedding,
      payload: {
        skillId: vector.skillId,
        userId: vector.userId,
        classId: vector.classId ?? null,
        source: vector.source,
        textSnippet: vector.textSnippet,
        classIndex: vector.classIndex ?? null,
        tokenCount: vector.tokenCount ?? null,
      },
    })),
  });

  return vectorIds;
};

/**
 * Semantic search over a user's vectors, filtered to that user.
 * Returns top-K context snippets ordered by similarity score.
 */
const searchSimilar = async (
  input: SearchSimilarInput,
): Promise<SearchSimilarHit[]> => {
  await ensureCollection();

  const must: unknown[] = [
    { key: "userId", match: { value: input.userId } },
  ];
  const filter: { must: unknown[]; must_not?: unknown[] } = { must };
  if (input.excludeSkillId !== undefined) {
    filter.must_not = [
      { key: "skillId", match: { value: input.excludeSkillId } },
    ];
  }

  const result = await getQdrantClient().query(QDRANT_COLLECTION, {
    query: input.embedding,
    filter,
    limit: input.topK ?? 5,
    with_payload: true,
    with_vector: false,
  });

  return result.points.map((point) => {
    const payload = point.payload as Record<string, unknown> | undefined;
    return {
      vectorId: Number(point.id),
      score: point.score ?? 0,
      textSnippet: (payload?.textSnippet as string) ?? "",
      source: (payload?.source as VectorSource) ?? VectorSource.AI_INITIAL,
      classIndex: (payload?.classIndex as number) ?? null,
      tokenCount: (payload?.tokenCount as number) ?? null,
    };
  });
};

export default { createVectors, searchSimilar };
