import type {
  ClassQuizJobPayload,
  GenerateClassQuiz,
} from "@/modules/tutoring/application/generate-class-quiz";

/**
 * Quiz generation shell: the broker owns retries (adapter budget → DLQ), so
 * failures propagate — a thrown error redelivers the message.
 */
export const getClassQuizJobHandler =
  (generate: GenerateClassQuiz) =>
  async (payload: ClassQuizJobPayload) => {
    await generate({
      classId: payload.classId,
      skillId: payload.skillId,
      quizTargets: payload.quizTargets,
    });
  };
