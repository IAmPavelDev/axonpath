import type { AiPort } from "@/modules/tutoring/ports";
import { embeddingTokenCounts } from "@/modules/tutoring/domain/embedding-tokens";
import type {
  NewVector,
  VectorMetadataRepository,
  VectorStoreError,
} from "@/modules/memory/ports";
import type { Result } from "@/modules/platform/result";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";
import { ClassQaStatus, VectorSource } from "@/prisma/generated";
import { conspectExcerpt } from "@/modules/memory/domain/split-conspect";

export const QA_BLOCK_VECTORS_JOB = "qa-block-vectors";

export type QaBlockVectorsJobPayload = { blockId: number };

export type MineQaVectorsDeps = {
  ai: Pick<AiPort, "generateEmbeddings">;
  vectorMetadata: VectorMetadataRepository;
  recordVectors: (vectors: NewVector[]) => Promise<Result<number[], VectorStoreError>>;
  qaRepo: Pick<ClassQaRepository, "findById">;
  classRepo: Pick<ClassRepository, "findById">;
};

/** The bound, dependency-complete use case — what the job registry consumes. */
export type MineQaVectors = (input: QaBlockVectorsJobPayload) => Promise<Result<void, never>>;

/**
 * Mine one answered Q&A block into memory (Phase 8 D5): an atomic third-person
 * fact keyed by its blockId — "what the learner asked and what Axon's answer
 * covered" — so future lessons and cross-skill retrieval remember the
 * exchange. Attribution is embedded in the template itself (Phase 8 D6-R5):
 * the question is the learner's typed words, the explanation is Axon's.
 *
 * Every failure — dedup read, block/class load, embeddings, record — degrades
 * to ok with nothing recorded, mirroring the answer miner: memory is never
 * load-bearing. A block is mined at most once ever; job replay no-ops.
 */
export const makeMineQaVectors =
  ({
    ai,
    vectorMetadata,
    recordVectors,
    qaRepo,
    classRepo,
  }: MineQaVectorsDeps): MineQaVectors =>
  async (input) => {
    try {
      const mined = await vectorMetadata.findBlockIdsWithVectors([input.blockId]);
      if (!mined.ok || mined.value.includes(input.blockId)) {
        return { ok: true, value: undefined };
      }

      const block = await qaRepo.findById(input.blockId);
      if (!block || block.status !== ClassQaStatus.ANSWERED || !block.answer) {
        return { ok: true, value: undefined };
      }
      const klass = await classRepo.findById(block.classId);
      if (!klass) {
        return { ok: true, value: undefined };
      }

      const snippet =
        `The learner asked: """${block.question}""" while reading the lesson "${klass.title}"; ` +
        `Axon's answer explained: ${conspectExcerpt(block.answer, 200)}`;
      const embeddings = await ai.generateEmbeddings([snippet]);
      if (!embeddings.ok || embeddings.value.embeddings.length !== 1) {
        return { ok: true, value: undefined };
      }

      const tokenCounts = embeddingTokenCounts(embeddings.value.usage, 1);
      // Record failure is a degrade too — the vectors are best-effort memory.
      await recordVectors([
        {
          skillId: klass.skillId,
          userId: block.userId,
          classId: klass.id,
          classIndex: klass.index,
          source: VectorSource.QA_DERIVED,
          textSnippet: snippet,
          embedding: embeddings.value.embeddings[0],
          tokenCount: tokenCounts[0],
          qaBlockId: block.id,
        },
      ]);
      return { ok: true, value: undefined };
    } catch {
      // Background best-effort memory: an unexpected failure degrades to
      // ok with nothing recorded, never rethrows into the job queue.
      return { ok: true, value: undefined };
    }
  };
