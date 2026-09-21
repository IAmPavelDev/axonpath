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
  const parsed = schema.quiz.GetQuizByClassIdOutput.element.parse(row);
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

  findScoreableByClassId: async (classId) =>
    prisma.question.findMany({
      where: { classId },
      select: { id: true, skillId: true, type: true, answerKey: true },
    }),

  createAnswers: async (inputs) => {
    if (inputs.length === 0) {
      return;
    }
    await prisma.answer.createMany({
      data: inputs.map((input) => ({
        questionId: input.questionId,
        userId: input.userId,
        skillId: input.skillId,
        content: input.content,
        score: input.score,
        isCorrect: input.isCorrect,
        timeSpentMs: input.timeSpentMs,
      })),
    });
  },
  findAnswersByClassAndUser: async (classId, userId) => {
    const rows = await prisma.answer.findMany({
      where: { userId, question: { classId } },
      orderBy: { id: "asc" },
      select: {
        questionId: true,
        content: true,
        isCorrect: true,
        question: { select: { text: true, answerKey: true } },
      },
    });
    return rows.map((row) => {
      // content follows the { answer: string } storage convention; answerKey
      // is a plain string for gradable types, an object only for open-ended.
      const content: unknown = row.content;
      const answerKey: unknown = row.question.answerKey;
      let userAnswer = String(content ?? "");
      if (
        typeof content === "object" &&
        content !== null &&
        !Array.isArray(content) &&
        "answer" in content &&
        typeof content.answer === "string"
      ) {
        userAnswer = content.answer;
      }
      return {
        questionId: row.questionId,
        questionText: row.question.text,
        userAnswer,
        correctAnswer:
          answerKey == null
            ? ""
            : typeof answerKey === "string"
              ? answerKey
              : JSON.stringify(answerKey),
        isCorrect: row.isCorrect,
      };
    });
  },
  findHighestAnsweredClassIndex: async (skillId, userId) => {
    const rows = await prisma.answer.findMany({
      where: { userId, question: { class: { skillId } } },
      distinct: ["questionId"],
      select: { question: { select: { class: { select: { index: true } } } } },
    });
    let highest: number | null = null;
    for (const row of rows) {
      // The where clause excludes class-less questions; the optional
      // relation is still nullable in the selected type.
      const index = row.question.class?.index;
      if (index !== null && index !== undefined && (highest === null || index > highest)) {
        highest = index;
      }
    }
    return highest;
  },
});
