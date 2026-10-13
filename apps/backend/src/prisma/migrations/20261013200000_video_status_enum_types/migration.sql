-- The video-enrichment migration created the status columns as TEXT but
-- never issued the CREATE TYPE for the Prisma enums schema.prisma declares.
-- Reads and raw queries work, but every enum WRITE casts to the type name
-- (`$1::"RecommendationsStatus"`) and fails with 42704. Create the missing
-- types and convert the columns.

CREATE TYPE "RecommendationsStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
CREATE TYPE "ClassClipStatus" AS ENUM ('PENDING', 'READY', 'SKIPPED');
CREATE TYPE "VideoAssetStatus" AS ENUM ('DISCOVERED', 'INDEXED', 'NO_TRANSCRIPT', 'FAILED');

ALTER TABLE "Skill" ALTER COLUMN "recommendationsStatus" TYPE "RecommendationsStatus" USING "recommendationsStatus"::"RecommendationsStatus";

ALTER TABLE "Class" ALTER COLUMN "clipStatus" DROP DEFAULT;
ALTER TABLE "Class" ALTER COLUMN "clipStatus" TYPE "ClassClipStatus" USING "clipStatus"::"ClassClipStatus";
ALTER TABLE "Class" ALTER COLUMN "clipStatus" SET DEFAULT 'SKIPPED';

ALTER TABLE "VideoAsset" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "VideoAsset" ALTER COLUMN "status" TYPE "VideoAssetStatus" USING "status"::"VideoAssetStatus";
ALTER TABLE "VideoAsset" ALTER COLUMN "status" SET DEFAULT 'DISCOVERED';
