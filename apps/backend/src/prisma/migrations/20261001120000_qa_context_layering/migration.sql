-- Phase 8: QA context layering + skill-scoped vector memory.
-- The learner's verbatim selection at ask time (null = anchored by tap only).
ALTER TABLE "ClassQaBlock" ADD COLUMN "anchorText" TEXT;

-- Conspect-chunk and mined-QA memory sources (single-quoted literals).
ALTER TYPE "VectorSource" ADD VALUE 'CONTENT_CHUNK';
ALTER TYPE "VectorSource" ADD VALUE 'QA_DERIVED';

-- Dedup key for QA-block memory mining (metadata-only; mirrors answerId).
ALTER TABLE "Vector" ADD COLUMN "qaBlockId" INTEGER;
CREATE INDEX "Vector_qaBlockId_idx" ON "Vector"("qaBlockId");
ALTER TABLE "Vector" ADD CONSTRAINT "Vector_qaBlockId_fkey" FOREIGN KEY ("qaBlockId") REFERENCES "ClassQaBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
