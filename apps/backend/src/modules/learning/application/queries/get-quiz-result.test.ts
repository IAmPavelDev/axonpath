import { describe, expect, it } from "vitest";
import type { QuestionType } from "@/prisma/generated";
import type { LatestAttemptRow } from "@/modules/learning/domain/quiz/quiz.repository";
import { makeGetQuizResult, type GetQuizResultDeps } from "./get-quiz-result";

const row = (overrides: Partial<LatestAttemptRow> = {}): LatestAttemptRow => ({
  questionId: 1,
  questionType: "MULTIPLE_CHOICE" as QuestionType,
  userAnswer: "INNER JOIN",
  isCorrect: true,
  answerKey: "INNER JOIN",
  ...overrides,
});

const makeDeps = (rows: LatestAttemptRow[]) => {
  const deps: GetQuizResultDeps = {
    quizRepo: {
      findLatestAttemptResults: async () => rows,
    },
  };
  return deps;
};

describe("makeGetQuizResult", () => {
  const input = { classId: 5, userId: 7 };

  it("returns null when the learner never submitted", async () => {
    const result = await makeGetQuizResult(makeDeps([]))(input);
    expect(result).toBeNull();
  });

  it("maps rows into the submit-shaped results view", async () => {
    const result = await makeGetQuizResult(
      makeDeps([
        row({
          questionId: 2,
          questionType: "OPEN_ENDED",
          userAnswer: "It filters rows before grouping.",
          isCorrect: null,
          answerKey: "WHERE filters rows; HAVING filters groups.",
        }),
        row({ questionId: 1, userAnswer: "LEFT JOIN", isCorrect: false }),
      ]),
    )(input);

    expect(result).toEqual({
      score: 0,
      total: 2,
      perQuestion: [
        {
          questionId: 1,
          type: "MULTIPLE_CHOICE",
          isCorrect: false,
          correctAnswer: "INNER JOIN",
          userAnswer: "LEFT JOIN",
        },
        {
          questionId: 2,
          type: "OPEN_ENDED",
          isCorrect: null,
          // The model answer never leaves the server for open-ended questions.
          correctAnswer: null,
          userAnswer: "It filters rows before grouping.",
        },
      ],
    });
  });

  it("counts only graded-correct answers in the score", async () => {
    const result = await makeGetQuizResult(
      makeDeps([
        row({ questionId: 1, isCorrect: true }),
        row({ questionId: 2, isCorrect: false, userAnswer: "b" }),
        row({
          questionId: 3,
          questionType: "OPEN_ENDED",
          isCorrect: null,
          answerKey: null,
        }),
      ]),
    )(input);

    expect(result).toEqual({
      score: 1,
      total: 3,
      perQuestion: expect.any(Array),
    });
  });
});
