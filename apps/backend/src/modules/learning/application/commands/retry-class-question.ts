import { err, ok, type Result } from "@/modules/platform/result";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { CLASS_QA_ANSWER_JOB } from "@/modules/tutoring/application/answer-class-question";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassQaStatus } from "@/prisma/generated";
import type { ClassQaError } from "@/modules/learning/domain/class-qa/class-qa";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";

export type RetryClassQuestionDeps = {
  classRepo: ClassRepository;
  skillRepo: SkillRepository;
  qaRepo: ClassQaRepository;
  jobs: JobQueuePort;
};

export type RetryClassQuestionInput = {
  classId: number;
  userId: number;
  blockId: number;
};

export type RetryClassQuestionOutput = {
  blockId: number;
  status: "PENDING";
};

export type RetryClassQuestionError =
  | ClassQaError
  | { kind: "BlockNotFound"; blockId: number }
  | { kind: "QaRetryNotAllowed"; blockId: number; status: ClassQaStatus };

/**
 * Restart a terminal FAILED Q&A block in place — the client's "Try again".
 * The block keeps its id and anchor (no duplicate cards), flips back to
 * PENDING with a fresh requeue budget, and the answer job re-fires. Ownership
 * mirrors ask: class → skill chain, NotOwned hidden behind 404.
 */
export const makeRetryClassQuestion =
  ({ classRepo, skillRepo, qaRepo, jobs }: RetryClassQuestionDeps) =>
  async (
    input: RetryClassQuestionInput,
  ): Promise<Result<RetryClassQuestionOutput, RetryClassQuestionError>> => {
    const klass = await classRepo.findById(input.classId);
    if (!klass) {
      return err({ kind: "ClassNotFound", classId: input.classId });
    }

    const skill = await skillRepo.findById(klass.skillId);
    if (!skill) {
      return err({ kind: "ClassNotFound", classId: input.classId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: skill.id });
    }

    const block = await qaRepo.findById(input.blockId);
    if (
      !block ||
      block.classId !== input.classId ||
      block.userId !== input.userId
    ) {
      return err({ kind: "BlockNotFound", blockId: input.blockId });
    }
    if (block.status !== "FAILED") {
      return err({
        kind: "QaRetryNotAllowed",
        blockId: block.id,
        status: block.status,
      });
    }

    // Atomic flip — a block that raced to ANSWERED between findById and now
    // is left alone and the retry surfaces as not-allowed.
    const reset = await qaRepo.resetForRetry(block.id);
    if (!reset) {
      return err({
        kind: "QaRetryNotAllowed",
        blockId: block.id,
        status: block.status,
      });
    }

    jobs.enqueue(CLASS_QA_ANSWER_JOB, { blockId: reset.id });

    return ok({ blockId: reset.id, status: "PENDING" });
  };
