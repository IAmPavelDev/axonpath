-- DropIndex
DROP INDEX "Vector_qaBlockId_idx";

-- CreateTable
CREATE TABLE "AiAttempt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "operation" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "rawChars" INTEGER,
    "promptVersion" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "errorKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAttempt_operation_createdAt_idx" ON "AiAttempt"("operation", "createdAt");

-- CreateIndex
CREATE INDEX "AiAttempt_promptVersion_outcome_idx" ON "AiAttempt"("promptVersion", "outcome");
