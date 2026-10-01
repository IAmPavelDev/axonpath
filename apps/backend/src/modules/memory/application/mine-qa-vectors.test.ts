import { describe, expect, it } from "vitest";
import { makeMineQaVectors, type MineQaVectorsDeps } from "./mine-qa-vectors";
import { err, ok, type Result } from "@/modules/platform/result";
import type {
  NewVector,
  VectorMetadataRepository,
  VectorStoreError,
} from "@/modules/memory/ports";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";
import type { ClassQaEntity } from "@/modules/learning/domain/class-qa/class-qa";
import type { AiPort } from "@/modules/tutoring/ports";
import { ClassQaStatus, VectorSource } from "@/prisma/generated";

const CLASS_ROW = {
  id: 5,
  skillId: 10,
  index: 2,
  title: "Joins",
  contentMd: "## Intro",
};

const answeredBlock = (overrides: Partial<ClassQaEntity> = {}): ClassQaEntity => ({
  id: 101,
  classId: 5,
  userId: 7,
  anchorParagraph: 1,
  anchorText: null,
  question: "When does a left join drop rows?",
  answer: "When the right side has no match; the row survives with NULLs.",
  status: ClassQaStatus.ANSWERED,
  aiModel: "glm-5.3-flash",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...overrides,
});

/** Test seam: scriptable dedup + embedding failures, capturing recordVectors. */
const makeFakeDeps = (options: {
  minedBlockIds?: number[];
  metadataFails?: boolean;
  embeddingsFail?: boolean;
  block?: ClassQaEntity | null;
  klass?: typeof CLASS_ROW | null;
  recordFails?: boolean;
} = {}) => {
  const recorded: NewVector[] = [];

  const vectorMetadata: VectorMetadataRepository = {
    sumTokenCountsByUser: async () => ({ totalTokens: 0, nullCount: 0 }),
    findAnswerIdsWithVectors: async () => ok([]),
    findClassIdsWithVectors: async () => ok([]),
    findBlockIdsWithVectors: async (blockIds) =>
      options.metadataFails
        ? err({ kind: "VectorStoreUnavailable", detail: "metadata down" })
        : ok(options.minedBlockIds ?? []),
  };
  const recordVectors = async (
    vectors: NewVector[],
  ): Promise<Result<number[], VectorStoreError>> => {
    if (options.recordFails) {
      return err({ kind: "VectorUpsertFailed", detail: "qdrant down" });
    }
    recorded.push(...vectors);
    return ok(vectors.map((_, i) => i));
  };
  const qaRepo: Pick<ClassQaRepository, "findById"> = {
    findById: async (id) =>
      options.block !== undefined ? options.block : id === 101 ? answeredBlock() : null,
  };
  const classRepo: Pick<ClassRepository, "findById"> = {
    findById: async () => (options.klass === undefined ? CLASS_ROW : options.klass),
  };
  const ai: Pick<AiPort, "generateEmbeddings"> = {
    generateEmbeddings: async (content) =>
      options.embeddingsFail
        ? err({ kind: "AiGenerationFailed", detail: "embeddings down" })
        : ok({ embeddings: content.map(() => [0.1, 0.2, 0.3]) }),
  };

  const deps: MineQaVectorsDeps = {
    ai,
    vectorMetadata,
    recordVectors,
    qaRepo,
    classRepo,
  };
  return { deps, recorded };
};

describe("makeMineQaVectors", () => {
  it("mines one attributed QA_DERIVED vector per answered block", async () => {
    const { deps, recorded } = makeFakeDeps();

    const result = await makeMineQaVectors(deps)({ blockId: 101 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      skillId: 10,
      userId: 7,
      classId: 5,
      classIndex: 2,
      source: VectorSource.QA_DERIVED,
      qaBlockId: 101,
    });
    // Attribution embedded in the template (D6-R5): typed question vs Axon's answer.
    expect(recorded[0].textSnippet).toBe(
      'The learner asked: """When does a left join drop rows?""" while reading the lesson "Joins"; ' +
        "Axon's answer explained: When the right side has no match; the row survives with NULLs.",
    );
  });

  it("never mines a block twice — dedup runs before any work", async () => {
    const { deps, recorded } = makeFakeDeps({ minedBlockIds: [101] });

    const result = await makeMineQaVectors(deps)({ blockId: 101 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });

  it("skips blocks that never reached ANSWERED with an answer", async () => {
    const { deps, recorded } = makeFakeDeps({
      block: answeredBlock({ status: ClassQaStatus.PENDING, answer: null }),
    });

    const result = await makeMineQaVectors(deps)({ blockId: 101 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });

  it("degrades to ok with nothing recorded when embeddings fail", async () => {
    const { deps, recorded } = makeFakeDeps({ embeddingsFail: true });

    const result = await makeMineQaVectors(deps)({ blockId: 101 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });

  it("degrades to ok when the dedup read fails", async () => {
    const { deps, recorded } = makeFakeDeps({ metadataFails: true });

    const result = await makeMineQaVectors(deps)({ blockId: 101 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });

  it("degrades to ok when the record fails", async () => {
    const { deps, recorded } = makeFakeDeps({ recordFails: true });

    const result = await makeMineQaVectors(deps)({ blockId: 101 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });
});
