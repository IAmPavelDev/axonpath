/**
 * Review-list semantics for `findWrongAnswersBySkill`, as a pure function the
 * Prisma adapter applies to recency-ordered attempt rows: the latest attempt
 * per question wins, and only questions whose latest attempt is graded-wrong
 * survive. A correct retake heals the question; a pending (ungraded) latest
 * attempt is not a mistake yet. Output keeps the input's recency order.
 */
export type AttemptRow = {
  questionId: number;
  isCorrect: boolean | null;
};

export const latestWrongPerQuestion = <T extends AttemptRow>(rows: T[]): T[] => {
  const latest = new Map<number, T>();
  for (const row of rows) {
    if (!latest.has(row.questionId)) {
      latest.set(row.questionId, row);
    }
  }
  return [...latest.values()].filter((row) => row.isCorrect === false);
};
