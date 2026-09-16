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
 * (see scoring.ts); persistence of answers is out of scope until quiz.submit
 * is wired.
 */
export type SubmittedAnswer = {
  questionId: number;
  answer: string;
};

export type QuizError = { kind: "ClassNotFound"; classId: number };
