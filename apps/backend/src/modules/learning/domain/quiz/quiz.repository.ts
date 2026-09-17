import type { NewAnswer, NewQuestion, QuestionView, ScoreableQuestion } from "./question";

export type QuizRepository = {
  /** Batch-insert questions; returns created ids in input order. */
  createQuestions(inputs: NewQuestion[]): Promise<number[]>;
  findByClassId(classId: number): Promise<QuestionView[]>;
  /** Questions with answer keys + owning skillId, for server-side scoring. */
  findScoreableByClassId(classId: number): Promise<ScoreableQuestion[]>;
  /** Batch-insert scored attempts. */
  createAnswers(inputs: NewAnswer[]): Promise<void>;
};
