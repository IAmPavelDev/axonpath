import { describe, expect, it } from "vitest";
import {
  makeVectorizeClassContent,
  type VectorizeClassContentDeps,
} from "./vectorize-class-content";
import { err, ok, type Result } from "@/modules/platform/result";
import type {
  NewVector,
  VectorMetadataRepository,
  VectorStoreError,
} from "@/modules/memory/ports";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { AiPort } from "@/modules/tutoring/ports";
import { VectorSource } from "@/prisma/generated";

const CLASS_ROW = {
  id: 5,
  skillId: 10,
  index: 2,
  title: "Joins",
  contentMd: "## Intro\nMeet the join.\n\n## Left join\nKeeps left rows.",
  baseLanguage: null,
};
const SKILL = {
  id: 10,
  userId: 7,
  topic: "SQL",
  prompt: "",
  description: "",
  status: "ACTIVE",
};

/** Test seam: scriptable dedup + embedding failures, capturing recordVectors. */
const makeFakeDeps = (options: {
  alreadyVectorized?: number[];
  metadataFails?: boolean;
  embeddingsFail?: boolean;
  klass?: typeof CLASS_ROW | null;
  skill?: typeof SKILL | null;
  recordFails?: boolean;
} = {}) => {
  const recorded: NewVector[] = [];

  const vectorMetadata: VectorMetadataRepository = {
    sumTokenCountsByUser: async () => ({ totalTokens: 0, nullCount: 0 }),
    findAnswerIdsWithVectors: async () => ok([]),
    findClassIdsWithVectors: async (classIds) =>
      options.metadataFails
        ? err({ kind: "VectorStoreUnavailable", detail: "metadata down" })
        : ok(options.alreadyVectorized ?? []),
    findBlockIdsWithVectors: async () => ok([]),
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
  const classRepo: Pick<ClassRepository, "findById"> = {
    findById: async () => (options.klass === undefined ? CLASS_ROW : options.klass),
  };
  const skillRepo: Pick<SkillRepository, "findById"> = {
    findById: async () => (options.skill === undefined ? SKILL : options.skill),
  };
  const ai: Pick<AiPort, "generateEmbeddings"> = {
    generateEmbeddings: async (content) =>
      options.embeddingsFail
        ? err({ kind: "AiGenerationFailed", detail: "embeddings down" })
        : ok({ embeddings: content.map(() => [0.1, 0.2, 0.3]) }),
  };

  const deps: VectorizeClassContentDeps = {
    ai,
    vectorMetadata,
    recordVectors,
    classRepo,
    skillRepo,
  };
  return { deps, recorded };
};

describe("makeVectorizeClassContent", () => {
  it("embeds one CONTENT_CHUNK vector per top-level conspect block", async () => {
    const { deps, recorded } = makeFakeDeps();

    const result = await makeVectorizeClassContent(deps)({ classId: 5 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({
      skillId: 10,
      userId: 7,
      classId: 5,
      classIndex: 2,
      source: VectorSource.CONTENT_CHUNK,
      textSnippet: "## Intro\nMeet the join.",
    });
    expect(recorded[1]).toMatchObject({
      textSnippet: "## Left join\nKeeps left rows.",
    });
  });

  it("never vectorizes a class twice — dedup runs before any work", async () => {
    const { deps, recorded } = makeFakeDeps({ alreadyVectorized: [5] });

    const result = await makeVectorizeClassContent(deps)({ classId: 5 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });

  it("degrades to ok with nothing recorded when the class is gone", async () => {
    const { deps, recorded } = makeFakeDeps({ klass: null });

    const result = await makeVectorizeClassContent(deps)({ classId: 5 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });

  it("degrades to ok when embeddings fail", async () => {
    const { deps, recorded } = makeFakeDeps({ embeddingsFail: true });

    const result = await makeVectorizeClassContent(deps)({ classId: 5 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });

  it("degrades to ok when the dedup read fails", async () => {
    const { deps, recorded } = makeFakeDeps({ metadataFails: true });

    const result = await makeVectorizeClassContent(deps)({ classId: 5 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });

  it("degrades to ok when the record fails", async () => {
    const { deps, recorded } = makeFakeDeps({ recordFails: true });

    const result = await makeVectorizeClassContent(deps)({ classId: 5 });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toHaveLength(0);
  });
});
