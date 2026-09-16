import type { QuestionView, SubmittedAnswer } from "./question";

/**
 * Pure scoring logic. MC/TF are exact matches against the stored answerKey
 * (the answer key is stored as the canonical string). OPEN_ENDED cannot be
 * auto-scored — it requires AI grading (a tutoring concern, not yet built),
 * so it scores 0 with isCorrect=false.
 */
export const scoreAnswer = (
  question: Pick<QuestionView, "type"> & { answerKey: unknown },
  answer: Pick<SubmittedAnswer, "answer">,
): { isCorrect: boolean; score: number } => {
  if (question.type === "OPEN_ENDED") {
    return { isCorrect: false, score: 0 };
  }

  const expected =
    typeof question.answerKey === "string"
      ? question.answerKey
      : JSON.stringify(question.answerKey);

  const isCorrect = expected === answer.answer;

  return { isCorrect, score: isCorrect ? 1 : 0 };
};
