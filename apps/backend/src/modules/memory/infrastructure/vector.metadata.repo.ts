import { Prisma, VectorSource } from "@/prisma/generated";
import { prisma } from "@/modules/platform/infrastructure/prisma";
import { err, ok, type Result } from "@/modules/platform/result";
import {
  ensureCollection,
  getQdrantClient,
  QDRANT_COLLECTION,
} from "@/modules/memory/infrastructure/qdrant.client";
import type {
  SearchSimilarHit,
  VectorMetadataRepository,
  VectorStoreError,
  VectorStorePort,
} from "@/modules/memory/ports";

const detailOf = (errLike: unknown): string =>
  errLike instanceof Error ? errLike.message : String(errLike);

export const makeVectorStoreAdapter = (): VectorStorePort => ({
  /**
   * Persists vector metadata as relational `Vector` rows and upserts the
   * embeddings into Qdrant (point id = the relational row id). Returns the
   * created row ids in input order.
   */
  upsert: async (vectors): Promise<Result<number[], VectorStoreError>> => {
    if (vectors.length === 0) {
      return ok([]);
    }

    try {
      await ensureCollection();
    } catch (errLike) {
      return err({
        kind: "VectorStoreUnavailable",
        detail: detailOf(errLike),
      });
    }

    let rows: { id: number }[];
    try {
      const tuples = vectors.map((vector) =>
        Prisma.sql`(
          ${vector.skillId},
          ${vector.classId ?? null},
          ${vector.source}::"VectorSource",
          ${vector.textSnippet},
          ${vector.classIndex ?? null},
          ${vector.tokenCount ?? null},
          ${vector.answerId ?? null},
          ${vector.qaBlockId ?? null}
        )`,
      );

      rows = await prisma.$queryRaw<{ id: number }[]>`
        INSERT INTO "Vector" (
          "skillId",
          "classId",
          "source",
          "textSnippet",
          "classIndex",
          "tokenCount",
          "answerId",
          "qaBlockId"
        ) VALUES ${Prisma.join(tuples)}
        RETURNING "id";
      `;
    } catch (errLike) {
      return err({
        kind: "VectorUpsertFailed",
        detail: detailOf(errLike),
      });
    }

    const vectorIds = rows.map((row) => row.id);

    try {
      await getQdrantClient().upsert(QDRANT_COLLECTION, {
        wait: true,
        points: vectors.map((vector, i) => ({
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
    } catch (errLike) {
      return err({
        kind: "VectorUpsertFailed",
        detail: detailOf(errLike),
      });
    }

    return ok(vectorIds);
  },

  /**
   * Semantic search over a user's vectors, filtered to that user. `skillId`
   * narrows to one skill's memory; `excludeSkillId` keeps a skill from
   * retrieving its own vectors back (the payload index on `skillId` already
   * exists — Phase 8 D4 adds the positive filter).
   */
  searchSimilar: async (input): Promise<Result<SearchSimilarHit[], VectorStoreError>> => {
    try {
      await ensureCollection();
    } catch (errLike) {
      return err({
        kind: "VectorStoreUnavailable",
        detail: detailOf(errLike),
      });
    }

    const must: unknown[] = [{ key: "userId", match: { value: input.userId } }];
    if (input.skillId !== undefined) {
      must.push({ key: "skillId", match: { value: input.skillId } });
    }
    const filter: { must: unknown[]; must_not?: unknown[] } = { must };
    if (input.excludeSkillId !== undefined) {
      filter.must_not = [
        { key: "skillId", match: { value: input.excludeSkillId } },
      ];
    }

    try {
      const result = await getQdrantClient().query(QDRANT_COLLECTION, {
        query: input.embedding,
        filter,
        limit: input.topK ?? 5,
        with_payload: true,
        with_vector: false,
      });

      return ok(
        result.points.map((point) => {
          const payload = point.payload as Record<string, unknown> | undefined;
          return {
            vectorId: Number(point.id),
            score: point.score ?? 0,
            textSnippet: (payload?.textSnippet as string) ?? "",
            source: (payload?.source as VectorSource) ?? "AI_INITIAL",
            classIndex: (payload?.classIndex as number) ?? null,
            tokenCount: (payload?.tokenCount as number) ?? null,
          } satisfies SearchSimilarHit;
        }),
      );
    } catch (errLike) {
      return err({
        kind: "VectorStoreUnavailable",
        detail: detailOf(errLike),
      });
    }
  },
});

/**
 * Metadata-only read side (relational Vector rows, no Qdrant round-trip).
 * Backs the memory-mining dedup checks: a mined answer / Q&A block / class
 * leaves a vector row keyed by its id, so these queries are the
 * "already mined" checks.
 */
export const makeVectorMetadataRepository = (): VectorMetadataRepository => ({
  findAnswerIdsWithVectors: async (answerIds) => {
    if (answerIds.length === 0) {
      return ok([]);
    }
    try {
      const rows = await prisma.vector.findMany({
        where: { answerId: { in: answerIds } },
        select: { answerId: true },
        distinct: ["answerId"],
      });
      return ok(
        rows.map((row) => row.answerId).filter((id): id is number => id !== null),
      );
    } catch (errLike) {
      return err({
        kind: "VectorStoreUnavailable",
        detail: detailOf(errLike),
      });
    }
  },

  findClassIdsWithVectors: async (classIds, source) => {
    if (classIds.length === 0) {
      return ok([]);
    }
    try {
      const rows = await prisma.vector.findMany({
        where: { classId: { in: classIds }, source },
        select: { classId: true },
        distinct: ["classId"],
      });
      return ok(
        rows.map((row) => row.classId).filter((id): id is number => id !== null),
      );
    } catch (errLike) {
      return err({
        kind: "VectorStoreUnavailable",
        detail: detailOf(errLike),
      });
    }
  },

  findBlockIdsWithVectors: async (blockIds) => {
    if (blockIds.length === 0) {
      return ok([]);
    }
    try {
      const rows = await prisma.vector.findMany({
        where: { qaBlockId: { in: blockIds } },
        select: { qaBlockId: true },
        distinct: ["qaBlockId"],
      });
      return ok(
        rows.map((row) => row.qaBlockId).filter((id): id is number => id !== null),
      );
    } catch (errLike) {
      return err({
        kind: "VectorStoreUnavailable",
        detail: detailOf(errLike),
      });
    }
  },

  sumTokenCountsByUser: async (userId, skillId) => {
    const agg = await prisma.vector.aggregate({
      where: {
        userId,
        ...(skillId !== undefined ? { skillId } : {}),
      },
      _sum: { tokenCount: true },
      _count: { _all: true, tokenCount: true },
    });
    return {
      totalTokens: agg._sum.tokenCount ?? 0,
      nullCount: agg._count._all - agg._count.tokenCount,
    };
  },
});
