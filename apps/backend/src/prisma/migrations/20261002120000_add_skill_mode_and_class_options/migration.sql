-- CreateEnum
CREATE TYPE "SkillMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "NextClassOptionsState" AS ENUM ('NONE', 'PENDING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'CLASS_OPTIONS_GENERATED';

-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "mode" "SkillMode" NOT NULL DEFAULT 'AUTOMATIC',
ADD COLUMN     "optionsState" "NextClassOptionsState" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "optionsStateAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NextClassJob" ADD COLUMN     "target" TEXT;

-- CreateTable
CREATE TABLE "NextClassOption" (
    "id" SERIAL NOT NULL,
    "skillId" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NextClassOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NextClassOption_skillId_rank_idx" ON "NextClassOption"("skillId", "rank");

-- AddForeignKey
ALTER TABLE "NextClassOption" ADD CONSTRAINT "NextClassOption_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

