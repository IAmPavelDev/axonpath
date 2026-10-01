import type { ClassQaStatus } from "@/prisma/generated";
import type { ClassQaEntity } from "./class-qa";

export type NewClassQaBlock = {
  classId: number;
  userId: number;
  anchorParagraph: number;
  /** Verbatim learner selection; null when anchored by tap only. */
  anchorText?: string | null;
  question: string;
};

export type ClassQaRepository = {
  create(input: NewClassQaBlock): Promise<Pick<ClassQaEntity, "id" | "status">>;
  /** Ascending (anchorParagraph, createdAt, id): document order, then ask order. */
  listByClass(classId: number): Promise<ClassQaEntity[]>;
  /**
   * Most recent ANSWERED blocks first (createdAt desc, id desc), capped at
   * `limit` — the QA answer prompt's history layer (Phase 8 L3).
   */
  listAnsweredByClass(classId: number, limit: number): Promise<ClassQaEntity[]>;
  findById(id: number): Promise<ClassQaEntity | null>;
  /** Terminal transition PENDING → ANSWERED; the answer arrives fully formed. */
  answer(id: number, input: { answer: string; aiModel: string }): Promise<void>;
  /** Terminal transition PENDING → FAILED; the client re-asks to retry. */
  markFailed(id: number): Promise<void>;
  /**
   * Atomically claim stranded PENDING blocks (untouched since `olderThan`,
   * requeueCount below `maxRequeues`): requeueCount + 1 per claim, FOR UPDATE
   * SKIP LOCKED so concurrent sweepers never claim the same block.
   */
  claimStranded(input: {
    olderThan: Date;
    maxRequeues: number;
    limit: number;
  }): Promise<Pick<ClassQaEntity, "id">[]>;
  /** Terminal give-up: FAILED for PENDING blocks that burned their requeues. */
  failExhausted(input: { olderThan: Date; maxRequeues: number }): Promise<number>;
};

export type { ClassQaStatus };
