import type { QuestionView } from "@/modules/learning/domain/quiz/question";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";

export type GetQuizDeps = { quizRepo: QuizRepository };
export type GetQuizOutput = QuestionView[];

export const makeGetQuiz =
  ({ quizRepo }: GetQuizDeps) =>
  async (classId: number): Promise<GetQuizOutput> =>
    quizRepo.findByClassId(classId);
