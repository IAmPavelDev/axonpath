import type { Question as PrismaQuestion } from "@/prisma/generated";
import type { Question } from "@axon/api-contract";
import { schema } from "@axon/api-contract";

/** Input: the raw row shape Prisma returns from a question `select`. Imported, single source of truth. */
export type QuestionRow = PrismaQuestion;

/** Output: the contract Question. Imported, single source of truth from the contract package. */
export type QuestionDto = Question;

/**
 * Map a DB row into the contract Question.
 *
 * `choices` is a JSON column (Prisma.JsonValue) whose runtime shape is unknowable
 * at compile time — so we validate it with the contract's own schema rather than
 * assuming it is a string[]. A malformed value fails fast instead of leaking.
 */
export const toQuestionDto = (row: QuestionRow): QuestionDto =>
  schema.quiz.SubmitQuizAnswersOutput.element.parse(row);