-- Video enrichment: recommendations (skill-level) + lesson clips (class-level).

-- AlterTable: enums arrive via CREATE TYPE below; existing classes render
-- plain (SKIPPED) — enrichment status is set to PENDING explicitly at
-- creation time for new classes only.
ALTER TABLE "Class" ADD COLUMN "clipStatus" TEXT NOT NULL DEFAULT 'SKIPPED';
ALTER TABLE "Class" ADD COLUMN "clipAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Class" ADD COLUMN "clipLeaseAt" TIMESTAMP(3);
ALTER TABLE "Skill" ADD COLUMN "recommendationsStatus" TEXT;
ALTER TABLE "Skill" ADD COLUMN "recommendationsAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VideoAsset" (
    "id" SERIAL NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT '',
    "durationSeconds" INTEGER,
    "transcript" JSONB,
    "transcriptSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillRecommendation" (
    "id" SERIAL NOT NULL,
    "skillId" INTEGER NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT '',
    "durationSeconds" INTEGER,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassVideoClip" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "anchorParagraph" INTEGER NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT '',
    "startSeconds" DOUBLE PRECISION NOT NULL,
    "endSeconds" DOUBLE PRECISION NOT NULL,
    "transcriptExcerpt" TEXT,
    "concept" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassVideoClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoAsset_videoId_key" ON "VideoAsset"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillRecommendation_skillId_videoId_key" ON "SkillRecommendation"("skillId", "videoId");

-- CreateIndex
CREATE INDEX "SkillRecommendation_skillId_rank_idx" ON "SkillRecommendation"("skillId", "rank");

-- CreateIndex
CREATE INDEX "ClassVideoClip_classId_anchorParagraph_idx" ON "ClassVideoClip"("classId", "anchorParagraph");

-- AddForeignKey
ALTER TABLE "SkillRecommendation" ADD CONSTRAINT "SkillRecommendation_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassVideoClip" ADD CONSTRAINT "ClassVideoClip_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
