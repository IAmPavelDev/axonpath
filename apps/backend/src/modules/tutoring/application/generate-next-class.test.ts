import { describe, expect, it } from "vitest";
import {
  makeGenerateNextClass,
  type GenerateNextClassDeps,
} from "./generate-next-class";
import type { AnswerReview } from "@/modules/learning/domain/quiz/quiz.repository";
import type { DomainEvent } from "@/modules/learning/domain/event/event.repository";
import type { AiError } from "@/modules/tutoring/ports";
import type { NewVector } from "@/modules/memory/ports";
import { ok } from "@/modules/platform/result";

const LESSON_JSON = JSON.stringify({
  classTitle: "Joins deep dive",
  classContentMd: "## Introduction\nOuter joins in practice.",
  lessonSummary: "The learner practiced outer joins and result filtering.",
  questions: [
    {
      type: "MULTIPLE_CHOICE",
      text: "Which join keeps unmatched left rows?",
      choices: ["LEFT JOIN", "INNER JOIN"],
      answerKey: "LEFT JOIN",
    },
  ],
  contextSnippets: [
    "Struggled with LEFT JOIN basics",
    "Comfortable with SELECT filters",
  ],
});

const SKILL = { id: 10, topic: "SQL joins", description: "", status: "ACTIVE" };

type NextClassState = {
  prompts: string[];
  createdClasses: { skillId: number; index: number; title: string; contentMd: string }[];
  questionInputs: unknown[];
  vectors: NewVector[];
  events: DomainEvent[];
};

/** Test seam: in-memory deps capturing every interaction. */
const makeDeps = (
  overrides: {
    skill?: typeof SKILL | null;
    last?: { id: number; index: number; title: string } | null;
    answers?: AnswerReview[];
    history?: { textSnippet: string; source: string; classIndex: number | null }[];
    initRaw?: string;
    initError?: AiError;
  } = {},
) => {
  const state: NextClassState = {
    prompts: [],
    createdClasses: [],
    questionInputs: [],
    vectors: [],
    events: [],
  };

  const deps: GenerateNextClassDeps = {
    ai: {
      generateJson: async (_input, request) => {
        if (request.schemaName === "next_class") {
          if (overrides.initError) {
            return { ok: false, error: overrides.initError };
          }
          state.prompts.push(_input.prompt);
          return ok({ raw: overrides.initRaw ?? LESSON_JSON });
        }
        throw new Error(`unexpected schema ${request.schemaName}`);
      },
      generateEmbeddings: async (content) =>
        ok(content.map(() => [0.1, 0.2, 0.3])),
    },
    retrieveContext: async () => overrides.history ?? [],
    skillRepo: {
      create: async () => {
        throw new Error("not used in next-class tests");
      },
      update: async () => {
        throw new Error("not used in next-class tests");
      },
      findById: async () =>
        overrides.skill === undefined ? SKILL : overrides.skill,
      listByUser: async () => {
        throw new Error("not used in next-class tests");
      },
    },
    classRepo: {
      create: async (input) => {
        state.createdClasses.push(input);
        return { id: 77 };
      },
      listBySkill: async () => {
        throw new Error("not used in next-class tests");
      },
      findTopBySkill: async () =>
        overrides.last === undefined
          ? { id: 5, index: 2, title: "Previous lesson" }
          : overrides.last,
      findById: async () => {
        throw new Error("not used in next-class tests");
      },
    },
    quizRepo: {
      createQuestions: async (inputs) => {
        state.questionInputs.push(...inputs);
        return inputs.map((_, i) => 100 + i);
      },
      findByClassId: async () => {
        throw new Error("not used in next-class tests");
      },
      findScoreableByClassId: async () => {
        throw new Error("not used in next-class tests");
      },
      createAnswers: async () => {
        throw new Error("not used in next-class tests");
      },
      findAnswersByClassAndUser: async () => overrides.answers ?? [],
    },
    eventRepo: {
      record: async (event) => {
        state.events.push(event);
      },
    },
    recordVectors: async (vectors) => {
      state.vectors.push(...vectors);
      return ok(vectors.map((_, i) => 900 + i));
    },
    chatModel: "glm-5.3-flash",
  };

  return { deps, state };
};

describe("makeGenerateNextClass", () => {
  it("creates the next class at index + 1 with questions and memory vectors", async () => {
    const { deps, state } = makeDeps({
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "B", correctAnswer: "A", isCorrect: false },
        { questionId: 2, questionText: "Q2", userAnswer: "True", correctAnswer: "True", isCorrect: true },
      ],
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 7 });

    expect(result.ok).toBe(true);
    expect(state.createdClasses).toEqual([
      {
        skillId: 10,
        index: 3,
        title: "Joins deep dive",
        contentMd: "## Introduction\nOuter joins in practice.",
        aiModel: "glm-5.3-flash",
      },
    ]);
    expect(state.questionInputs).toHaveLength(1);
    expect(state.questionInputs[0]).toMatchObject({
      skillId: 10,
      classId: 77,
      answerKey: "LEFT JOIN",
    });

    // Memory: summary as AI_NEXT first, snippets as AI_INITIAL — all at the
    // new classIndex so the next generation can lift the summary.
    expect(state.vectors).toHaveLength(3);
    expect(state.vectors[0]).toMatchObject({
      source: "AI_NEXT",
      classIndex: 3,
      classId: 77,
      skillId: 10,
      userId: 7,
    });
    expect(state.vectors[0]?.textSnippet).toContain("outer joins");
    expect(state.vectors.slice(1).map((v) => v.source)).toEqual([
      "AI_INITIAL",
      "AI_INITIAL",
    ]);

    // Audit parity with init: CLASS_GENERATED carries prompt + raw response.
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      skillId: 10,
      userId: 7,
      type: "CLASS_GENERATED",
    });
    const payload = state.events[0]?.payload as {
      action: string;
      prompt: string;
      response: string;
    };
    expect(payload.action).toBe("next_class");
    expect(payload.response).toBe(LESSON_JSON);
    expect(payload.prompt).toContain("SQL joins");
  });

  it("feeds missed questions with their correct answers into the prompt", async () => {
    const { deps, state } = makeDeps({
      answers: [
        {
          questionId: 1,
          questionText: "What does LEFT JOIN do?",
          userAnswer: "Filters rows",
          correctAnswer: "Keeps unmatched left rows",
          isCorrect: false,
        },
      ],
    });

    await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    const prompt = state.prompts[0] ?? "";
    expect(prompt).toContain("missed these questions");
    expect(prompt).toContain("What does LEFT JOIN do?");
    expect(prompt).toContain("Filters rows");
    expect(prompt).toContain("Keeps unmatched left rows");
    expect(prompt).not.toContain("increase the difficulty");
  });

  it("raises difficulty when every attempt was correct", async () => {
    const { deps, state } = makeDeps({
      answers: [
        { questionId: 2, questionText: "Q2", userAnswer: "True", correctAnswer: "True", isCorrect: true },
      ],
    });

    await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    const prompt = state.prompts[0] ?? "";
    expect(prompt).toContain("increase the difficulty");
    expect(prompt).not.toContain("missed these questions");
  });

  it("keeps only the newest attempt per question, in both retake directions", async () => {
    const newerWrong = makeDeps({
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "right", correctAnswer: "A", isCorrect: true },
        { questionId: 1, questionText: "Q1", userAnswer: "wrong", correctAnswer: "A", isCorrect: false },
      ],
    });
    await makeGenerateNextClass(newerWrong.deps)({ skillId: 10, userId: 1 });
    expect(newerWrong.state.prompts[0]).toContain("missed these questions");
    expect(newerWrong.state.prompts[0]).toContain("wrong");

    const newerRight = makeDeps({
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "wrong", correctAnswer: "A", isCorrect: false },
        { questionId: 1, questionText: "Q1", userAnswer: "right", correctAnswer: "A", isCorrect: true },
      ],
    });
    await makeGenerateNextClass(newerRight.deps)({ skillId: 10, userId: 1 });
    expect(newerRight.state.prompts[0]).toContain("increase the difficulty");
    expect(newerRight.state.prompts[0]).not.toContain("wrong");
  });

  it("splits retrieval hits by source and lifts the previous lesson summary", async () => {
    const { deps, state } = makeDeps({
      history: [
        { textSnippet: "Learner is comfortable with SELECTs", source: "AI_INITIAL", classIndex: 0 },
        { textSnippet: "Lesson 2 covered inner joins at depth", source: "AI_NEXT", classIndex: 2 },
        { textSnippet: "Lesson 0 introduced tables", source: "AI_NEXT", classIndex: 0 },
      ],
    });

    await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    const prompt = state.prompts[0] ?? "";
    expect(prompt).toContain(
      "What the previous lesson covered: Lesson 2 covered inner joins at depth",
    );
    expect(prompt).toContain("Lessons already covered");
    expect(prompt).toContain("Lesson 0 introduced tables");
    expect(prompt).toContain("Learner is comfortable with SELECTs");
    // The lifted summary is rendered once — not duplicated in the covered list.
    expect(prompt.indexOf("Lesson 2 covered inner joins at depth")).toBe(
      prompt.lastIndexOf("Lesson 2 covered inner joins at depth"),
    );
  });

  it("proceeds with empty history blocks when retrieval yields nothing", async () => {
    const { deps, state } = makeDeps({
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "B", correctAnswer: "A", isCorrect: false },
      ],
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result.ok).toBe(true);
    const prompt = state.prompts[0] ?? "";
    expect(prompt).not.toContain("Lessons already covered");
    expect(prompt).not.toContain("learner already knows these facts");
    expect(state.createdClasses).toHaveLength(1);
  });

  it("fails NoClassesYet without calling the AI when init has not produced a class", async () => {
    const { deps, state } = makeDeps({ last: null });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result).toEqual({ ok: false, error: { kind: "NoClassesYet", skillId: 10 } });
    expect(state.prompts).toHaveLength(0);
    expect(state.createdClasses).toHaveLength(0);
  });

  it("fails SkillNotFound for an unknown skill", async () => {
    const { deps, state } = makeDeps({ skill: null });

    const result = await makeGenerateNextClass(deps)({ skillId: 404, userId: 1 });

    expect(result).toEqual({ ok: false, error: { kind: "SkillNotFound", skillId: 404 } });
    expect(state.prompts).toHaveLength(0);
  });

  it("fails AiResponseInvalid and persists nothing when the model output is unparseable", async () => {
    const { deps, state } = makeDeps({ initRaw: "Here is your lesson — no JSON though." });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AiResponseInvalid");
    expect(state.createdClasses).toHaveLength(0);
    expect(state.questionInputs).toHaveLength(0);
    expect(state.vectors).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("propagates AiGenerationFailed from the AI adapter", async () => {
    const { deps, state } = makeDeps({
      initError: { kind: "AiGenerationFailed", detail: "rate limited" },
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "AiGenerationFailed", detail: "rate limited" },
    });
    expect(state.createdClasses).toHaveLength(0);
    expect(state.vectors).toHaveLength(0);
  });
});
