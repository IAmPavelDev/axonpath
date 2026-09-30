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
/**
 * Answer.content follows the { answer: string } storage convention; a
 * malformed value degrades to its string form instead of throwing.
 */
const answerTextOf = (content: unknown): string => {
  if (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    "answer" in content &&
    typeof content.answer === "string"
  ) {
    return content.answer;
  }
  return String(content ?? "");
};

export const makePrismaQuizRepository = (): QuizRepository => ({
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
      return [];
    }
    const created = await prisma.answer.createManyAndReturn({
      data: inputs.map((input) => ({
        questionId: input.questionId,
        userId: input.userId,
        skillId: input.skillId,
        content: input.content,
        score: input.score,
        isCorrect: input.isCorrect,
        timeSpentMs: input.timeSpentMs,
      })),
      select: { id: true },
    });
    return created.map((row) => row.id);
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
      // answerKey is a plain string for gradable types, an object only for
      // open-ended — stringified for the AI-facing review either way.
      const answerKey: unknown = row.question.answerKey;
      return {
        questionId: row.questionId,
        questionText: row.question.text,
        userAnswer: answerTextOf(row.content),
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

  findAnswerStatsBySkill: async (skillId, userId) => {
    // Distinct-question semantics, the same rule SkillRepository.listByUser
    // applies to its per-class counts: grouping questions (not answers) with
    // an answers.some filter counts each answered question once no matter how
    // many retake attempts it has; "correct" is answered correctly at least
    // once. Class-less questions are excluded, as in listByUser.
    const [answered, correct] = await Promise.all([
      prisma.question.groupBy({
        by: ["classId"],
        where: { skillId, classId: { not: null }, answers: { some: { userId } } },
        _count: { _all: true },
      }),
      prisma.question.groupBy({
        by: ["classId"],
        where: {
          skillId,
          classId: { not: null },
          answers: { some: { userId, isCorrect: true } },
        },
        _count: { _all: true },
      }),
    ]);

    const correctByClass = new Map<number, number>(
      correct.map((row) => [row.classId!, row._count._all]),
    );
    return answered.map((row) => ({
      classId: row.classId!,
      answeredCount: row._count._all,
      correctCount: correctByClass.get(row.classId!) ?? 0,
    }));
  },

  findAnswersWithQuestions: async (answerIds) => {
    if (answerIds.length === 0) {
      return [];
    }
    const rows = await prisma.answer.findMany({
      where: { id: { in: answerIds } },
      select: {
        id: true,
        questionId: true,
        content: true,
        isCorrect: true,
        question: {
          select: { id: true, type: true, text: true, answerKey: true, classId: true },
        },
      },
    });
    return rows.map((row) => ({
      answerId: row.id,
      questionId: row.question.id,
      questionType: row.question.type,
      questionText: row.question.text,
      answerKey: row.question.answerKey,
      userAnswer: answerTextOf(row.content),
      isCorrect: row.isCorrect,
      classId: row.question.classId,
    }));
  },
});
