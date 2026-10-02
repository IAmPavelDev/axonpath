import { describe, expect, it } from "vitest";
import {
  GRADE_FAILED_FEEDBACK,
  makeGradeOpenEnded,
  type GradeOpenEndedDeps,
} from "./grade-open-ended";
import { ok } from "@/modules/platform/result";
import type { AiError, AiPort } from "@/modules/tutoring/ports";
import type {
  AnswerWithQuestion,
  QuizRepository,
} from "@/modules/learning/domain/quiz/quiz.repository";

const unused = async (): Promise<never> => {
  throw new Error("not used in grader tests");
};

const openEnded = (
  id: number,
  over: Partial<AnswerWithQuestion> = {},
): AnswerWithQuestion => ({
  answerId: id,
  questionId: id * 10,
  questionType: "OPEN_ENDED",
  questionText: `Explain concept ${id}.`,
  answerKey: "The model answer.",
  userAnswer: "The learner's answer.",
  isCorrect: null,
  classId: 77,
  ...over,
});

const GRADING_RAW = JSON.stringify({
  results: [
    { answerId: 101, score: 0.9, correct: true, feedback: "Solid; cite the predicate." },
    { answerId: 102, score: 0.2, correct: false, feedback: "Missing the core idea." },
  ],
});

/** Test seam: scripted AI + capturing grade write-back. */
const makeFakeDeps = (options: {
  raw?: string;
  aiFails?: boolean;
  answers?: AnswerWithQuestion[];
}) => {
  const gradeRows: Array<{
    answerId: number;
    score: number;
    isCorrect: boolean;
    feedback: string;
  }>[] = [];
  let updateCalls = 0;

  const ai: AiPort = {
    generateJson: async () => {
      if (options.aiFails) {
        const error: AiError = { kind: "AiGenerationFailed", detail: "grader down" };
        return { ok: false, error };
      }
      return ok({ raw: options.raw ?? GRADING_RAW });
    },
    generateEmbeddings: unused,
    generateText: unused,
  };
  const quizRepo: QuizRepository = {
    findWrongAnswersBySkill: unused,
    findReviewCandidatesBySkill: unused,
    findAnswerActivityByUser: unused,
    findByClassId: unused,
    findScoreableByClassId: unused,
    createAnswers: unused,
    findAnswersByClassAndUser: unused,
    findHighestAnsweredClassIndex: unused,
    findAnswerStatsBySkill: unused,
    findAnswersWithQuestions: async () => options.answers ?? [],
    updateGrades: async (rows) => {
      updateCalls += 1;
      gradeRows.push(rows);
    },
  };

  const deps: GradeOpenEndedDeps = { ai, quizRepo };
  return { deps, gradeRows, lastRows: () => gradeRows.at(-1) ?? [], updateCalls };
};

describe("makeGradeOpenEnded", () => {
  it("grades a batch in ONE generateJson call and writes every row back", async () => {
    const { deps, gradeRows, lastRows } = makeFakeDeps({
      answers: [openEnded(101), openEnded(102)],
    });

    const result = await makeGradeOpenEnded(deps)({ answerIds: [101, 102] });

    expect(result).toEqual(ok(undefined));
    // ONE updateGrades call for the whole batch.
    expect(gradeRows).toHaveLength(1);
    expect(lastRows()).toEqual([
      {
        answerId: 101,
        score: 0.9,
        isCorrect: true,
        feedback: "Solid; cite the predicate.",
      },
      {
        answerId: 102,
        score: 0.2,
        isCorrect: false,
        feedback: "Missing the core idea.",
      },
    ]);
  });

  it("degrades the whole batch to failed grades when the AI errors", async () => {
    const { deps, lastRows } = makeFakeDeps({
      aiFails: true,
      answers: [openEnded(101), openEnded(102)],
    });

    const result = await makeGradeOpenEnded(deps)({ answerIds: [101, 102] });

    expect(result).toEqual(ok(undefined));
    expect(lastRows()).toEqual([
      { answerId: 101, score: 0, isCorrect: false, feedback: GRADE_FAILED_FEEDBACK },
      { answerId: 102, score: 0, isCorrect: false, feedback: GRADE_FAILED_FEEDBACK },
    ]);
  });

  it("degrades when the response is not parseable", async () => {
    const { deps, lastRows } = makeFakeDeps({
      raw: "not json at all",
      answers: [openEnded(101)],
    });

    const result = await makeGradeOpenEnded(deps)({ answerIds: [101] });

    expect(result).toEqual(ok(undefined));
    expect(lastRows()).toEqual([
      { answerId: 101, score: 0, isCorrect: false, feedback: GRADE_FAILED_FEEDBACK },
    ]);
  });

  it("treats absent results in a partial response as failed grades", async () => {
    const { deps, lastRows } = makeFakeDeps({
      // Only 101 comes back; 102 must not stay pending forever.
      raw: JSON.stringify({
        results: [
          { answerId: 101, score: 1, correct: true, feedback: "Perfect." },
        ],
      }),
      answers: [openEnded(101), openEnded(102)],
    });

    const result = await makeGradeOpenEnded(deps)({ answerIds: [101, 102] });

    expect(result).toEqual(ok(undefined));
    expect(lastRows()).toEqual([
      { answerId: 101, score: 1, isCorrect: true, feedback: "Perfect." },
      { answerId: 102, score: 0, isCorrect: false, feedback: GRADE_FAILED_FEEDBACK },
    ]);
  });

  it("clamps out-of-range scores and coerces bad entries to failed grades", async () => {
    const { deps, lastRows } = makeFakeDeps({
      raw: JSON.stringify({
        results: [
          { answerId: 101, score: 7, correct: "yes", feedback: "" },
          "garbage",
        ],
      }),
      answers: [openEnded(101), openEnded(102)],
    });

    const result = await makeGradeOpenEnded(deps)({ answerIds: [101, 102] });

    expect(result).toEqual(ok(undefined));
    expect(lastRows()).toEqual([
      {
        answerId: 101,
        score: 1,
        isCorrect: false,
        feedback: GRADE_FAILED_FEEDBACK,
      },
      { answerId: 102, score: 0, isCorrect: false, feedback: GRADE_FAILED_FEEDBACK },
    ]);
  });

  it("ignores non-open-ended rows and empty input", async () => {
    const { deps, lastRows, updateCalls } = makeFakeDeps({
      answers: [openEnded(101, { questionType: "TRUE_FALSE" })],
    });

    expect(await makeGradeOpenEnded(deps)({ answerIds: [101] })).toEqual(ok(undefined));
    expect(await makeGradeOpenEnded(deps)({ answerIds: [] })).toEqual(ok(undefined));
    expect(updateCalls).toBe(0);
    expect(lastRows()).toEqual([]);
  });
});
