import type { NewQuestion, QuestionView } from "./question";

export type QuizRepository = {
  /** Batch-insert questions; returns created ids in input order. */
  createQuestions(inputs: NewQuestion[]): Promise<number[]>;
  findByClassId(classId: number): Promise<QuestionView[]>;
};
