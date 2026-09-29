-- CreateEnum
CREATE TYPE "public"."ClassQaStatus" AS ENUM ('PENDING', 'ANSWERED', 'FAILED');

-- AlterEnum
ALTER TYPE "public"."EventType" ADD VALUE 'QA_ANSWERED';

-- CreateTable
CREATE TABLE "public"."ClassQaBlock" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "anchorParagraph" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "public"."ClassQaStatus" NOT NULL DEFAULT 'PENDING',
    "aiModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassQaBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassQaBlock_classId_anchorParagraph_idx" ON "public"."ClassQaBlock"("classId", "anchorParagraph");

-- CreateIndex
CREATE INDEX "ClassQaBlock_userId_idx" ON "public"."ClassQaBlock"("userId");

-- AddForeignKey
ALTER TABLE "public"."ClassQaBlock" ADD CONSTRAINT "ClassQaBlock_classId_fkey" FOREIGN KEY ("classId") REFERENCES "public"."Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassQaBlock" ADD CONSTRAINT "ClassQaBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
