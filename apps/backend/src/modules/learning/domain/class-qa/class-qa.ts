import type { ClassQaStatus } from "@/prisma/generated";

/**
 * ClassQaBlock — a learner question anchored inside a class conspect.
 * Blocks are flat (no nesting): a follow-up question is just another block
 * anchored after the previous answer. `anchorParagraph` indexes the class's
 * top-level markdown blocks in document order; stable because contentMd is
 * immutable once generated (regeneration creates a new class).
 */
export type ClassQaEntity = {
  id: number;
  classId: number;
  userId: number;
  anchorParagraph: number;
  /** Verbatim learner selection at ask time; null when anchored by tap only. */
  anchorText: string | null;
  question: string;
  /** Null while the answer has not been generated (PENDING / FAILED). */
  answer: string | null;
  status: ClassQaStatus;
  aiModel: string | null;
  createdAt: Date;
};

export type ClassQaError =
  | { kind: "ClassNotFound"; classId: number }
  | { kind: "NotOwned"; skillId: number };
