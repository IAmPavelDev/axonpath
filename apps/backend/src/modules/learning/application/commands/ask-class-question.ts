import { err, ok, type Result } from "@/modules/platform/result";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { CLASS_QA_ANSWER_JOB } from "@/modules/tutoring/application/answer-class-question";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassQaError } from "@/modules/learning/domain/class-qa/class-qa";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";

export type AskClassQuestionDeps = {
  classRepo: ClassRepository;
  skillRepo: SkillRepository;
  qaRepo: ClassQaRepository;
  jobs: JobQueuePort;
};

export type AskClassQuestionInput = {
  classId: number;
  userId: number;
  anchorParagraph: number;
  /** Verbatim learner selection (contract-capped at 2000); null when anchored by tap. */
  anchorText?: string | null;
  question: string;
};

export type AskClassQuestionOutput = {
  blockId: number;
  status: "PENDING";
};

/**
 * Anchor a learner question into a class conspect: persist a PENDING block
 * (the client renders it immediately with a skeleton answer) and fire the
 * in-process answer job. Ownership rides the class → skill chain, NotOwned
 * hidden behind 404 like every other command. The verbatim selection is
 * stored with the block (Phase 8 D2) — it is the L1 grounding quote of the
 * answer prompt and the card quote after reload.
 */
export const makeAskClassQuestion =
  ({ classRepo, skillRepo, qaRepo, jobs }: AskClassQuestionDeps) =>
  async (
    input: AskClassQuestionInput,
  ): Promise<Result<AskClassQuestionOutput, ClassQaError>> => {
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

    const block = await qaRepo.create({
      classId: input.classId,
      userId: input.userId,
      anchorParagraph: input.anchorParagraph,
      anchorText: input.anchorText ?? null,
      question: input.question,
    });

    jobs.enqueue(CLASS_QA_ANSWER_JOB, { blockId: block.id });

    return ok({ blockId: block.id, status: "PENDING" });
  };
