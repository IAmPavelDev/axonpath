import type { NewAnswer, NewQuestion, QuestionView, ScoreableQuestion } from "./question";

/** Flattened review of one recorded attempt, for AI prompt building. */
export type AnswerReview = {
  questionId: number;
  questionText: string;
  userAnswer: string;
  correctAnswer: string;
  /** null = not machine-gradable (open-ended, awaiting AI grading). */
  isCorrect: boolean | null;
};
export type QuizRepository = {
  /** Batch-insert questions; returns created ids in input order. */
  createQuestions(inputs: NewQuestion[]): Promise<number[]>;
  findByClassId(classId: number): Promise<QuestionView[]>;
  /** Questions with answer keys + owning skillId, for server-side scoring. */
  findScoreableByClassId(classId: number): Promise<ScoreableQuestion[]>;
  /** Batch-insert scored attempts. */
  createAnswers(inputs: NewAnswer[]): Promise<void>;
  /** All of a user's attempts for a class's questions, ordered id asc (earliest first). */
  findAnswersByClassAndUser(classId: number, userId: number): Promise<AnswerReview[]>;
};
