import type { QuestionType } from "@/prisma/generated";

/**
 * Question — the quiz attached to a class. `choices`/`answerKey` are JSON
 * columns; their runtime shape depends on QuestionType (string[] for MC,
 * scalar for TF, free-form for OPEN_ENDED).
 */
export type QuestionView = {
  id: number;
  type: QuestionType;
  text: string;
  choices: string[];
};

export type NewQuestion = {
  skillId: number;
  classId: number;
  type: QuestionType;
  text: string;
  choices: string[];
  answerKey: string;
  aiModel?: string;
};

/**
 * A user's recorded attempt at a question. Scoring is a pure domain function
 * (see scoring.ts); persistence happens in the submit-quiz use case.
 * `timeSpentMs` is optional client telemetry — persisted with the attempt,
 * defaulted to 0 when the client doesn't track it.
 */
export type SubmittedAnswer = {
  questionId: number;
  answer: string;
  timeSpentMs?: number;
};

/**
 * Server-side view of a question for scoring: carries the answerKey and the
 * owning skill. Never mapped to the wire — `findByClassId` remains the
 * client-facing view.
 */
export type ScoreableQuestion = {
  id: number;
  skillId: number;
  type: QuestionType;
  answerKey: unknown;
};

export type NewAnswer = {
  questionId: number;
  userId: number;
  skillId: number;
  /**
   * Storage convention for the Answer.content JSON column: `{ answer }` on
   * write; background grading merges feedback -> `{ answer, feedback }`.
   */
  content: { answer: string; feedback?: string };
  /** null = open-ended, pending background grading (Phase 7 D4). */
  score: number | null;
  isCorrect: boolean | null;
  timeSpentMs: number;
};

export type QuizError = { kind: "ClassNotFound"; classId: number };
