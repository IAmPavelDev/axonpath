import { prisma } from "@/modules/platform/infrastructure/prisma";
import { QuestionType } from "@/prisma/generated";
import { schema } from "@axon/api-contract";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import { latestWrongPerQuestion } from "@/modules/learning/domain/quiz/latest-wrong";
import type { ReviewCandidate } from "@/modules/learning/domain/quiz/review-schedule";
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

/** Grader feedback merged into content as { answer, feedback }; null otherwise. */
const feedbackOf = (content: unknown): string | null => {
  if (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    "feedback" in content &&
    typeof content.feedback === "string"
  ) {
    return content.feedback;
  }
  return null;
};

export const makePrismaQuizRepository = (): QuizRepository => ({
  findByClassId: async (classId) => {
    const rows = await prisma.question.findMany({
      where: { classId },
      select: { id: true, type: true, text: true, choices: true },
    });
    return rows.map(toQuestionView);
  },

  findLatestAttemptResults: async (classId, userId) => {
    // One attempt = one answer per question of the class (the client submits
    // all-or-nothing), so the latest attempt is simply the last N rows by id.
    const questionCount = await prisma.question.count({ where: { classId } });
    if (questionCount === 0) {
      return [];
    }
    const rows = await prisma.answer.findMany({
      where: { userId, question: { classId } },
      orderBy: { id: "desc" },
      take: questionCount,
      select: {
        questionId: true,
        content: true,
        isCorrect: true,
        question: { select: { type: true, answerKey: true } },
      },
    });
    return rows.reverse().map((row) => ({
      questionId: row.questionId,
      questionType: row.question.type,
      userAnswer: answerTextOf(row.content),
      isCorrect: row.isCorrect,
      answerKey: row.question.answerKey,
    }));
  },

  listPendingGradingIds: async (olderThan, limit) => {
    const rows = await prisma.answer.findMany({
      where: {
        isCorrect: null,
        createdAt: { lt: olderThan },
        question: { type: QuestionType.OPEN_ENDED },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: limit,
    });
    return rows.map((row) => row.id);
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
      if (
        index !== null &&
        index !== undefined &&
        (highest === null || index > highest)
      ) {
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
        where: {
          skillId,
          classId: { not: null },
          answers: { some: { userId } },
        },
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
          select: {
            id: true,
            type: true,
            text: true,
            answerKey: true,
            classId: true,
          },
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

  findWrongAnswersBySkill: async (skillId, userId) => {
    // 1. Latest attempt per question, then keep graded-wrong ones (pure fn —
    // a correct retake must heal the question, so filtering runs AFTER
    // latest-wins, not before).
    const attempts = await prisma.answer.findMany({
      where: { userId, question: { skillId } },
      select: {
        id: true,
        questionId: true,
        content: true,
        score: true,
        isCorrect: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const wrong = latestWrongPerQuestion(attempts);
    if (wrong.length === 0) {
      return [];
    }

    // 2. Question data for the surviving mistakes.
    const questions = await prisma.question.findMany({
      where: { id: { in: wrong.map((row) => row.questionId) } },
      select: {
        id: true,
        type: true,
        text: true,
        choices: true,
        answerKey: true,
        classId: true,
        class: { select: { index: true } },
      },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    return wrong.flatMap((row) => {
      const question = questionById.get(row.questionId);
      if (!question) {
        return [];
      }
      return [
        {
          answerId: row.id,
          questionId: row.questionId,
          questionType: question.type,
          questionText: question.text,
          choices: question.choices,
          answerKey: question.answerKey,
          userAnswer: answerTextOf(row.content),
          feedback: feedbackOf(row.content),
          score: row.score,
          classId: question.classId,
          classIndex: question.class?.index ?? null,
          answeredAt: row.createdAt,
        },
      ];
    });
  },

  findReviewCandidatesBySkill: async (skillId, userId) => {
    // One pass over the user's attempts in the skill, oldest first; grouped
    // per question in TS (a skill's history is small — beta scale — and the
    // grouping must preserve attempt order for the scheduler's recency logic).
    const rows = await prisma.answer.findMany({
      where: { userId, question: { skillId } },
      select: {
        questionId: true,
        isCorrect: true,
        createdAt: true,
        question: {
          select: {
            type: true,
            text: true,
            class: { select: { index: true } },
          },
        },
      },
      orderBy: { id: "asc" },
    });
    const byQuestion = new Map<number, ReviewCandidate>();
    for (const row of rows) {
      let candidate = byQuestion.get(row.questionId);
      if (!candidate) {
        candidate = {
          questionId: row.questionId,
          questionText: row.question.text,
          questionType: row.question.type,
          classIndex: row.question.class?.index ?? null,
          attempts: [],
        };
        byQuestion.set(row.questionId, candidate);
      }
      candidate.attempts.push({
        isCorrect: row.isCorrect,
        createdAt: row.createdAt,
      });
    }
    return [...byQuestion.values()];
  },

  updateGrades: async (rows) => {
    if (rows.length === 0) {
      return;
    }
    // Merge target is the content JSON: read the stored answers once, then
    // rewrite each as { answer, feedback } — answers are immutable once
    // written, so read-then-update cannot race a submit.
    const existing = await prisma.answer.findMany({
      where: { id: { in: rows.map((row) => row.answerId) } },
      select: { id: true, content: true },
    });
    const contentById = new Map(existing.map((row) => [row.id, row.content]));
    await prisma.$transaction(
      rows.map((row) =>
        prisma.answer.update({
          where: { id: row.answerId },
          data: {
            score: row.score,
            isCorrect: row.isCorrect,
            content: {
              answer: answerTextOf(contentById.get(row.answerId)),
              feedback: row.feedback,
            },
          },
        }),
      ),
    );
  },

  findAnswerActivityByUser: async (userId) => {
    const rows = await prisma.answer.findMany({
      where: { userId },
      select: {
        createdAt: true,
        skillId: true,
        questionId: true,
        question: { select: { classId: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      createdAt: row.createdAt,
      skillId: row.skillId,
      classId: row.question.classId,
      questionId: row.questionId,
    }));
  },
});
