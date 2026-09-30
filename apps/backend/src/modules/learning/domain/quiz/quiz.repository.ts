import type { QuestionType } from "@/prisma/generated";
import type { NewAnswer, QuestionView, ScoreableQuestion } from "./question";

/** Flattened review of one recorded attempt, for AI prompt building. */
export type AnswerReview = {
  questionId: number;
  questionText: string;
  userAnswer: string;
  correctAnswer: string;
  /** null = not machine-gradable (open-ended, awaiting AI grading). */
  isCorrect: boolean | null;
};

/**
 * A stored answer joined with its question — what memory mining (and, later,
 * open-ended grading) needs to judge or describe one recorded attempt.
 */
export type AnswerWithQuestion = {
  answerId: number;
  questionId: number;
  questionType: QuestionType;
  questionText: string;
  /** Raw Json column: a plain string for gradable types, an object for open-ended. */
  answerKey: unknown;
  /** Extracted from the { answer } content storage convention. */
  userAnswer: string;
  isCorrect: boolean | null;
  /** Null for class-less (skill-level) questions — they never belong to a lesson. */
  classId: number | null;
};

export type QuizRepository = {
  findByClassId(classId: number): Promise<QuestionView[]>;
  /** Questions with answer keys + owning skillId, for server-side scoring. */
  findScoreableByClassId(classId: number): Promise<ScoreableQuestion[]>;
  /** Batch-insert scored attempts; returns created ids in input order. */
  createAnswers(inputs: NewAnswer[]): Promise<number[]>;
  /** All of a user's attempts for a class's questions, ordered id asc (earliest first). */
  findAnswersByClassAndUser(classId: number, userId: number): Promise<AnswerReview[]>;
  /** Highest Class.index the user has any recorded answer for; null = no attempts. */
  findHighestAnsweredClassIndex(skillId: number, userId: number): Promise<number | null>;
  /**
   * Per-lesson answer aggregates for one user in a skill: distinct questions
   * answered, and of those, distinct questions answered correctly at least
   * once (retakes must not inflate the totals). Only classes that have at
   * least one answered question appear.
   */
  findAnswerStatsBySkill(
    skillId: number,
    userId: number,
  ): Promise<Array<{ classId: number; answeredCount: number; correctCount: number }>>;
  /**
   * Stored attempts by id, joined with their questions. Missing ids are
   * silently absent from the result, keeping lookups input-independent.
   */
  findAnswersWithQuestions(answerIds: number[]): Promise<AnswerWithQuestion[]>;
  /**
   * Write back AI grades for open-ended answers (Phase 7 D4): sets
   * Answer.score / Answer.isCorrect and merges the feedback into the
   * Answer.content JSON, which becomes `{ answer, feedback }` — the content
   * column is the merge target, so no migration and the original answer
   * text is preserved.
   */
  updateGrades(
    rows: Array<{ answerId: number; score: number; isCorrect: boolean; feedback: string }>,
  ): Promise<void>;
};
