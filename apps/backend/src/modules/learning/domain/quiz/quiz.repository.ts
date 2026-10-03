import type { QuestionType } from "@/prisma/generated";
import type { NewAnswer, QuestionView, ScoreableQuestion } from "./question";
import type { ReviewCandidate } from "./review-schedule";

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

/**
 * One graded-wrong attempt with everything a review list renders. `choices`
 * and `answerKey` are raw Json — the caller normalizes per question type
 * (and keeps the OPEN_ENDED model answer server-side, D4).
 */
export type WrongAnswerRow = {
  answerId: number;
  questionId: number;
  questionType: QuestionType;
  questionText: string;
  choices: unknown;
  answerKey: unknown;
  /** Extracted from the { answer } content storage convention. */
  userAnswer: string;
  /** Merged into content by background grading; null until/unless graded. */
  feedback: string | null;
  score: number | null;
  classId: number | null;
  classIndex: number | null;
  answeredAt: Date;
};

/**
 * One row of the learner's LATEST attempt for a class (the last N answers,
 * N = the class's question count), joined with what a results view needs.
 * `answerKey` is raw Json — the caller keeps OPEN_ENDED model answers
 * server-side and exposes gradable keys as the correct answer.
 */
export type LatestAttemptRow = {
  questionId: number;
  questionType: QuestionType;
  userAnswer: string;
  /** null = open-ended still awaiting (or failed) background grading. */
  isCorrect: boolean | null;
  answerKey: unknown;
};
export type QuizRepository = {
  findByClassId(classId: number): Promise<QuestionView[]>;
  /** Questions with answer keys + owning skillId, for server-side scoring. */
  findScoreableByClassId(classId: number): Promise<ScoreableQuestion[]>;
  /** Batch-insert scored attempts; returns created ids in input order. */
  createAnswers(inputs: NewAnswer[]): Promise<number[]>;
  /** All of a user's attempts for a class's questions, ordered id asc (earliest first). */
  findAnswersByClassAndUser(
    classId: number,
    userId: number,
  ): Promise<AnswerReview[]>;
  /**
   * The user's LATEST attempt for a class as results rows, one per question
   * of the class, attempt order preserved. Empty = never submitted.
   */
  findLatestAttemptResults(
    classId: number,
    userId: number,
  ): Promise<LatestAttemptRow[]>;
  /**
   * Open-ended answers still ungraded past `olderThan` — the recovery net's
   * enqueue set. Re-enqueueing is safe: grading settles every entry (a
   * verdict or the "Grading failed" row), which drops it from the query.
   */
  listPendingGradingIds(olderThan: Date, limit: number): Promise<number[]>;
  /** Highest Class.index the user has any recorded answer for; null = no attempts. */
  findHighestAnsweredClassIndex(
    skillId: number,
    userId: number,
  ): Promise<number | null>;
  /**
   * Per-lesson answer aggregates for one user in a skill: distinct questions
   * answered, and of those, distinct questions answered correctly at least
   * once (retakes must not inflate the totals). Only classes that have at
   * least one answered question appear.
   */
  findAnswerStatsBySkill(
    skillId: number,
    userId: number,
  ): Promise<
    Array<{ classId: number; answeredCount: number; correctCount: number }>
  >;
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
    rows: Array<{
      answerId: number;
      score: number;
      isCorrect: boolean;
      feedback: string;
    }>,
  ): Promise<void>;
  /**
   * Lightweight activity feed for stats derivations: every recorded attempt
   * of the user with the owning skill and — through the question — the class
   * it belongs to (null for class-less questions). Unbounded on purpose:
   * streak derivations need full history, and the scan is proportional to a
   * single user's answers (beta scale); swap for an aggregate query if that
   * ever stops being true.
   */
  findAnswerActivityByUser(userId: number): Promise<
    Array<{
      createdAt: Date;
      skillId: number | null;
      classId: number | null;
      questionId: number;
    }>
  >;
  /**
   * Review rows for one user's skill: the LATEST attempt per question wins,
   * and only questions whose latest attempt is graded-wrong appear — a
   * correct retake heals the question, a pending (ungraded) latest attempt
   * is not a mistake yet. Newest first.
   */
  findWrongAnswersBySkill(
    skillId: number,
    userId: number,
  ): Promise<WrongAnswerRow[]>;
  /**
   * Full attempt history per question of one user's skill, attempts oldest
   * first — the mastery ledger's raw material (review-schedule.ts). Every
   * graded and ungraded attempt counts; the pure scheduler decides what to
   * re-test.
   */
  findReviewCandidatesBySkill(
    skillId: number,
    userId: number,
  ): Promise<ReviewCandidate[]>;
};
