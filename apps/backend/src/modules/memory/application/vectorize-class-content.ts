import type { AiPort } from "@/modules/tutoring/ports";
import { embeddingTokenCounts } from "@/modules/tutoring/domain/embedding-tokens";
import type {
  NewVector,
  VectorMetadataRepository,
  VectorStoreError,
} from "@/modules/memory/ports";
import type { Result } from "@/modules/platform/result";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import { VectorSource } from "@/prisma/generated";
import { splitConspectChunks } from "@/modules/memory/domain/split-conspect";

export const CLASS_CONTENT_VECTORS_JOB = "class-content-vectors";

export type ClassContentVectorsJobPayload = { classId: number };

export type VectorizeClassContentDeps = {
  ai: Pick<AiPort, "generateEmbeddings">;
  vectorMetadata: VectorMetadataRepository;
  recordVectors: (vectors: NewVector[]) => Promise<Result<number[], VectorStoreError>>;
  classRepo: Pick<ClassRepository, "findById">;
  skillRepo: Pick<SkillRepository, "findById">;
};

/** The bound, dependency-complete use case — what the job registry consumes. */
export type VectorizeClassContent = (
  input: ClassContentVectorsJobPayload,
) => Promise<Result<void, never>>;

/**
 * Embed one class's conspect as CONTENT_CHUNK vectors — one per top-level
 * markdown block (Phase 8 D3). Skill-scoped retrieval for QA answers draws
 * on these, so the whole skill content becomes vector-addressable.
 *
 * contentMd is immutable per class, so this is one-shot: dedup is keyed per
 * (classId, source) and every failure — dedup read, class/skill load,
 * embeddings, record — degrades to ok with nothing recorded, mirroring the
 * retrieval policy: memory is never load-bearing. Job replay no-ops.
 */
export const makeVectorizeClassContent =
  ({
    ai,
    vectorMetadata,
    recordVectors,
    classRepo,
    skillRepo,
  }: VectorizeClassContentDeps): VectorizeClassContent =>
  async (input) => {
    try {
      const mined = await vectorMetadata.findClassIdsWithVectors(
        [input.classId],
        VectorSource.CONTENT_CHUNK,
      );
      if (!mined.ok || mined.value.includes(input.classId)) {
        return { ok: true, value: undefined };
      }

      const klass = await classRepo.findById(input.classId);
      if (!klass) {
        return { ok: true, value: undefined };
      }
      const skill = await skillRepo.findById(klass.skillId);
      if (!skill) {
        return { ok: true, value: undefined };
      }

      const chunks = splitConspectChunks(klass.contentMd);
      if (chunks.length === 0) {
        return { ok: true, value: undefined };
      }

      const embeddings = await ai.generateEmbeddings(chunks);
      if (!embeddings.ok || embeddings.value.embeddings.length !== chunks.length) {
        return { ok: true, value: undefined };
      }

      const tokenCounts = embeddingTokenCounts(
        embeddings.value.usage,
        embeddings.value.embeddings.length,
      );
      const vectors = chunks.map((chunk, i) => ({
        skillId: klass.skillId,
        userId: skill.userId,
        classId: klass.id,
        classIndex: klass.index,
        source: VectorSource.CONTENT_CHUNK,
        textSnippet: chunk,
        embedding: embeddings.value.embeddings[i],
        tokenCount: tokenCounts[i],
      })) satisfies NewVector[];

      // Record failure is a degrade too — the vectors are best-effort memory.
      await recordVectors(vectors);
      return { ok: true, value: undefined };
    } catch {
      // Background best-effort memory: an unexpected failure degrades to
      // ok with nothing recorded, never rethrows into the job queue.
      return { ok: true, value: undefined };
    }
  };
