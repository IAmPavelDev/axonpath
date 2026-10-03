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
    {
      answerId: 101,
      score: 0.9,
      correct: true,
      feedback: "Solid; cite the predicate.",
    },
    {
      answerId: 102,
      score: 0.2,
      correct: false,
      feedback: "Missing the core idea.",
    },
  ],
});

/** Test seam: scripted AI + capturing grade write-back. */
const makeFakeDeps = (options: {
  raw?: string;
  /** Per-attempt raws; the last one repeats for extra calls. */
  rawSequence?: string[];
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
  let aiCalls = 0;

  const ai: AiPort = {
    generateJson: async () => {
      aiCalls += 1;
      if (options.aiFails) {
        const error: AiError = {
          kind: "AiGenerationFailed",
          detail: "grader down",
        };
        return { ok: false, error };
      }
      const sequence = options.rawSequence;
      const raw = sequence
        ? sequence[Math.min(aiCalls - 1, sequence.length - 1)]
        : (options.raw ?? GRADING_RAW);
      return ok({ raw });
    },
    generateEmbeddings: unused,
    generateText: unused,
  };
  const quizRepo: QuizRepository = {
    findLatestAttemptResults: unused,
    listPendingGradingIds: unused,
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
  return {
    deps,
    gradeRows,
    lastRows: () => gradeRows.at(-1) ?? [],
    updateCalls,
    aiCalls: () => aiCalls,
  };
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
      {
        answerId: 101,
        score: 0,
        isCorrect: false,
        feedback: GRADE_FAILED_FEEDBACK,
      },
      {
        answerId: 102,
        score: 0,
        isCorrect: false,
        feedback: GRADE_FAILED_FEEDBACK,
      },
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
      {
        answerId: 101,
        score: 0,
        isCorrect: false,
        feedback: GRADE_FAILED_FEEDBACK,
      },
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
      {
        answerId: 102,
        score: 0,
        isCorrect: false,
        feedback: GRADE_FAILED_FEEDBACK,
      },
    ]);
  });

  it("clamps out-of-range scores and derives the verdict when fields drift", async () => {
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
      // 7 clamps to 1; "yes" is unreadable so the verdict derives from the
      // clamped score; the empty feedback falls to the verdict placeholder.
      { answerId: 101, score: 1, isCorrect: true, feedback: "Correct." },
      {
        answerId: 102,
        score: 0,
        isCorrect: false,
        feedback: GRADE_FAILED_FEEDBACK,
      },
    ]);
  });

  it("coerces drifted JSON types instead of failing the grade", async () => {
    const { deps, lastRows } = makeFakeDeps({
      // The provider treats json_schema as guidance: booleans as "true",
      // numbers as strings, ids as strings.
      raw: JSON.stringify({
        results: [
          {
            answerId: "101",
            score: "0.9",
            correct: "true",
            feedback: "Good.",
          },
          { answerId: "102", score: "0", correct: "false", feedback: "" },
        ],
      }),
      answers: [openEnded(101), openEnded(102)],
    });

    await makeGradeOpenEnded(deps)({ answerIds: [101, 102] });

    expect(lastRows()).toEqual([
      { answerId: 101, score: 0.9, isCorrect: true, feedback: "Good." },
      { answerId: 102, score: 0, isCorrect: false, feedback: "Incorrect." },
    ]);
  });

  it("regenerates once when the first response is unusable", async () => {
    const { deps, lastRows, aiCalls } = makeFakeDeps({
      rawSequence: ["not json at all", GRADING_RAW],
      answers: [openEnded(101), openEnded(102)],
    });

    const result = await makeGradeOpenEnded(deps)({ answerIds: [101, 102] });

    expect(result).toEqual(ok(undefined));
    expect(aiCalls()).toBe(2);
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

  it("stops retrying once a response parses", async () => {
    const { deps, aiCalls } = makeFakeDeps({
      answers: [openEnded(101)],
    });

    await makeGradeOpenEnded(deps)({ answerIds: [101] });

    expect(aiCalls()).toBe(1);
  });

  it("parses a bare results array with the envelope dropped", async () => {
    // Observed in production: the model emits the array items without the
    // { results: [...] } wrapper, which no brace-slicing can repair.
    const { deps, lastRows } = makeFakeDeps({
      raw: JSON.stringify([
        { answerId: 101, score: 1, correct: true, feedback: "Perfect." },
        { answerId: 102, score: 0.1, correct: false, feedback: "Off track." },
      ]),
      answers: [openEnded(101), openEnded(102)],
    });

    const result = await makeGradeOpenEnded(deps)({ answerIds: [101, 102] });

    expect(result).toEqual(ok(undefined));
    expect(lastRows()).toEqual([
      { answerId: 101, score: 1, isCorrect: true, feedback: "Perfect." },
      { answerId: 102, score: 0.1, isCorrect: false, feedback: "Off track." },
    ]);
  });

  it("parses a bare object sequence left by bracket-stripping", async () => {
    // The client slicer strips a top-level array's brackets, leaving this
    // comma-separated sequence — re-wrapped into an array before parsing.
    const { deps, lastRows } = makeFakeDeps({
      raw:
        '{ "answerId": 101, "score": 1, "correct": true, "feedback": "Perfect." },\n' +
        '{ "answerId": 102, "score": 0.1, "correct": false, "feedback": "Off track." }',
      answers: [openEnded(101), openEnded(102)],
    });

    const result = await makeGradeOpenEnded(deps)({ answerIds: [101, 102] });

    expect(result).toEqual(ok(undefined));
    expect(lastRows()).toEqual([
      { answerId: 101, score: 1, isCorrect: true, feedback: "Perfect." },
      { answerId: 102, score: 0.1, isCorrect: false, feedback: "Off track." },
    ]);
  });
  it("ignores non-open-ended rows and empty input", async () => {
    const { deps, lastRows, updateCalls } = makeFakeDeps({
      answers: [openEnded(101, { questionType: "TRUE_FALSE" })],
    });

    expect(await makeGradeOpenEnded(deps)({ answerIds: [101] })).toEqual(
      ok(undefined),
    );
    expect(await makeGradeOpenEnded(deps)({ answerIds: [] })).toEqual(
      ok(undefined),
    );
    expect(updateCalls).toBe(0);
    expect(lastRows()).toEqual([]);
  });
});
