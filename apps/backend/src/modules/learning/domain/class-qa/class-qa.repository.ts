import type { ClassQaStatus } from "@/prisma/generated";
import type { ClassQaEntity } from "./class-qa";

export type NewClassQaBlock = {
  classId: number;
  userId: number;
  anchorParagraph: number;
  question: string;
};

export type ClassQaRepository = {
  create(input: NewClassQaBlock): Promise<Pick<ClassQaEntity, "id" | "status">>;
  /** Ascending (anchorParagraph, createdAt, id): document order, then ask order. */
  listByClass(classId: number): Promise<ClassQaEntity[]>;
  findById(id: number): Promise<ClassQaEntity | null>;
  /** Terminal transition PENDING → ANSWERED; the answer arrives fully formed. */
  answer(id: number, input: { answer: string; aiModel: string }): Promise<void>;
  /** Terminal transition PENDING → FAILED; the client re-asks to retry. */
  markFailed(id: number): Promise<void>;
};

export type { ClassQaStatus };
