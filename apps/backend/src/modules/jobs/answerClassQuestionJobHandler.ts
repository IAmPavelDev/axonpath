import type { ClassQaAnswerJobPayload } from "@/modules/tutoring/application/answer-class-question";
import type { AnswerClassQuestion } from "@/modules/tutoring/application/answer-class-question";

/**
 * The instant trigger for ask-class-question's in-memory job. The use case
 * owns every terminal transition (ANSWERED / FAILED); a thrown error here
 * would leave the block PENDING forever, so thrown errors are caught by the
 * queue's fire-and-forget policy and the result error is logged.
 */
export const getAnswerClassQuestionJobHandler = (
  answerClassQuestion: AnswerClassQuestion,
) => {
  return async (payload: ClassQaAnswerJobPayload) => {
    const result = await answerClassQuestion(payload);
    if (!result.ok) {
      console.error(
        { blockId: payload.blockId, error: result.error },
        "Class Q&A answer job failed",
      );
    }
  };
};
