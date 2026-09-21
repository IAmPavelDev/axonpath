-- Durable queue marker for next-lesson generation: submit-quiz upserts one row
-- per skill (skillId unique -> retakes re-arm instead of stacking), the minute
-- sweeper and the instant in-process job claim it atomically. No FK to Skill
-- on purpose: infrastructure bookkeeping, skills are never deleted.
CREATE TYPE "NextClassJobStatus" AS ENUM ('PENDING', 'PROCESSING');

CREATE TABLE "NextClassJob" (
    "id" SERIAL NOT NULL,
    "skillId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "NextClassJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NextClassJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NextClassJob_skillId_key" ON "NextClassJob"("skillId");
