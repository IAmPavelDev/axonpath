import { prisma } from "@/modules/platform/infrastructure/prisma";
import { schema } from "@axon/api-contract";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { QuestionView } from "@/modules/learning/domain/quiz/question";

/**
 * Map a DB row into the contract Question. `choices` is a JSON column whose
 * runtime shape is unknowable at compile time — validate with the contract's
 * own schema rather than assuming string[]. A malformed value fails fast.
 */
const toQuestionView = (row: {
  id: number;
  type: QuestionView["type"];
  text: string;
  choices: unknown;
}): QuestionView => {
  const parsed = schema.quiz.SubmitQuizAnswersOutput.element.parse(row);
  return parsed;
};

export const makePrismaQuizRepository = (): QuizRepository => ({
  createQuestions: async (inputs) => {
    if (inputs.length === 0) {
      return [];
    }

    const created = await prisma.question.createManyAndReturn({
      data: inputs.map((input) => ({
        skillId: input.skillId,
        classId: input.classId,
        type: input.type,
        text: input.text,
        choices: input.choices,
        answerKey: input.answerKey,
        aiModel: input.aiModel,
      })),
      select: { id: true },
    });

    return created.map((row) => row.id);
  },

  findByClassId: async (classId) => {
    const rows = await prisma.question.findMany({
      where: { classId },
      select: { id: true, type: true, text: true, choices: true },
    });
    return rows.map(toQuestionView);
  },
});
