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

const SKILL = { id: 10, userId: 7, topic: "SQL joins", description: "", status: "ACTIVE" };

type NextClassState = {
  prompts: string[];
  createdClasses: { skillId: number; index: number; title: string; contentMd: string; aiModel?: string }[];
  questionInputs: unknown[];
  vectors: NewVector[];
  events: DomainEvent[];
  skillUpdates: { id: number; patch: Record<string, unknown> }[];
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
    answeredIndex?: number | null;
  } = {},
) => {
  const state: NextClassState = {
    prompts: [],
    createdClasses: [],
    questionInputs: [],
    vectors: [],
    events: [],
    skillUpdates: [],
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
      generateText: async () => {
        throw new Error("generateText not used in next-class tests");
      },
    },
    retrieveContext: async () => overrides.history ?? [],
    skillRepo: {
      create: async () => {
        throw new Error("not used in next-class tests");
      },
      update: async (id, patch) => {
        state.skillUpdates.push({ id, patch });
        return { id, topic: "SQL joins", description: "", status: "ACTIVE" };
      },
      findById: async () =>
        overrides.skill === undefined ? SKILL : overrides.skill,
      listByUser: async () => {
        throw new Error("not used in next-class tests");
      },
      listByStatus: async () => {
        throw new Error("not used in next-class tests");
      },
    },
    classRepo: {
      createWithQuestions: async (cls, questions) => {
        state.createdClasses.push(cls);
        state.questionInputs.push(...questions);
        return { id: 77 };
      },
      listBySkill: async () => {
        throw new Error("not used in next-class tests");
      },
      listBySkillByIndex: async () => {
        throw new Error("not used in next-class tests");
      },
      listByIds: async () => {
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
      findHighestAnsweredClassIndex: async () => {
        if (overrides.answeredIndex !== undefined) {
          return overrides.answeredIndex;
        }
        // Default: the learner has answered through the newest class, so the
        // dedup guard never fires unless a test asks for it.
        const last =
          overrides.last === undefined
            ? { id: 5, index: 2, title: "Previous lesson" }
            : overrides.last;
        return last?.index ?? null;
      },
      findAnswerStatsBySkill: async () => {
        throw new Error("not used in next-class tests");
      },
      findAnswersWithQuestions: async () => {
        throw new Error("not used in next-class tests");
      },
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
    // Composite persist: the questions ride in the same call as the class
    // (classId 77 is assigned inside the fake, not carried in the input).
    expect(state.questionInputs).toEqual([
      {
        type: "MULTIPLE_CHOICE",
        text: "Which join keeps unmatched left rows?",
        choices: ["LEFT JOIN", "INNER JOIN"],
        answerKey: "LEFT JOIN",
        aiModel: "glm-5.3-flash",
      },
    ]);

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

  it("no-ops a PAUSED skill: no AI call, no class, no event, no settle", async () => {
    const { deps, state } = makeDeps({
      skill: { ...SKILL, status: "PAUSED" },
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "B", correctAnswer: "A", isCorrect: false },
      ],
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 7 });

    expect(result).toEqual(ok(undefined));
    expect(state.prompts).toHaveLength(0);
    expect(state.createdClasses).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.vectors).toHaveLength(0);
    // The status is not ours to settle: PAUSED stays PAUSED.
    expect(state.skillUpdates).toHaveLength(0);
  });

  it("no-ops a COMPLETED skill the same way", async () => {
    const { deps, state } = makeDeps({
      skill: { ...SKILL, status: "COMPLETED" },
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 7 });

    expect(result).toEqual(ok(undefined));
    expect(state.prompts).toHaveLength(0);
    expect(state.createdClasses).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.skillUpdates).toHaveLength(0);
  });

  it("renders the known-gaps block only from ANSWER_DERIVED hits", async () => {
    const { deps, state } = makeDeps({
      history: [
        { textSnippet: "Inner joins were covered last lesson", source: "AI_NEXT", classIndex: 0 },
        { textSnippet: "Struggled with: LEFT JOIN filters.", source: "ANSWER_DERIVED", classIndex: 0 },
      ],
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "B", correctAnswer: "A", isCorrect: false },
      ],
    });

    await makeGenerateNextClass(deps)({ skillId: 10, userId: 7 });

    const prompt = state.prompts[0] ?? "";
    expect(prompt).toContain(
      "Known gaps — the learner has missed these before; weave in a re-test",
    );
    expect(prompt).toContain("- Struggled with: LEFT JOIN filters.");
    // The pre-existing history blocks are unchanged by the third block.
    expect(prompt).toContain("Lessons already covered — build on them; do not repeat them:");
    expect(prompt).toContain("- Inner joins were covered last lesson");
  });

  it("omits the known-gaps block when retrieval has no ANSWER_DERIVED hits", async () => {
    const { deps, state } = makeDeps({
      history: [
        { textSnippet: "Inner joins were covered last lesson", source: "AI_NEXT", classIndex: 0 },
        { textSnippet: "First exposure to SQL joins", source: "AI_INITIAL", classIndex: 0 },
      ],
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "B", correctAnswer: "A", isCorrect: false },
      ],
    });

    await makeGenerateNextClass(deps)({ skillId: 10, userId: 7 });

    const prompt = state.prompts[0] ?? "";
    expect(prompt).not.toContain("Known gaps");
    expect(prompt).toContain("The learner already knows these facts");
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

  it("skips generation on a consecutive retake of the newest class", async () => {
    // The learner answered through class 2 and class 3 exists unanswered:
    // a retake of class 2 must not spawn a variant of class 3.
    const { deps, state } = makeDeps({
      last: { id: 5, index: 3, title: "Newest lesson" },
      answeredIndex: 2,
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "B", correctAnswer: "A", isCorrect: false },
      ],
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result.ok).toBe(true);
    expect(state.prompts).toHaveLength(0);
    expect(state.createdClasses).toHaveLength(0);
    expect(state.questionInputs).toHaveLength(0);
    expect(state.vectors).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("generates when the learner has answered through the newest class", async () => {
    // Fresh submit of class 2 while class 2 is the newest: k+1 must appear.
    const { deps, state } = makeDeps({
      answeredIndex: 2,
      answers: [
        { questionId: 1, questionText: "Q1", userAnswer: "B", correctAnswer: "A", isCorrect: false },
      ],
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result.ok).toBe(true);
    expect(state.prompts).toHaveLength(1);
    expect(state.createdClasses[0]).toMatchObject({ index: 3 });
    expect(state.events[0]).toMatchObject({ type: "CLASS_GENERATED" });
  });

  it("generates when no answers exist at all (null answered index)", async () => {
    // Without recorded attempts there is no evidence the learner is behind;
    // generation is the safe default (matches pre-dedup behavior).
    const { deps, state } = makeDeps({ answeredIndex: null });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result.ok).toBe(true);
    expect(state.prompts).toHaveLength(1);
    expect(state.createdClasses[0]).toMatchObject({ index: 3 });
  });

  it("settles a GENERATING skill back to ACTIVE after a successful generation", async () => {
    // submit-quiz flipped the skill before enqueueing; the pipeline owns
    // closing the phase once the next class is persisted.
    const { deps, state } = makeDeps({
      skill: { ...SKILL, status: "GENERATING" },
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 7 });

    expect(result.ok).toBe(true);
    expect(state.skillUpdates).toEqual([
      { id: 10, patch: { status: "ACTIVE" } },
    ]);
  });

  it("settles a GENERATING skill back to ACTIVE on the dedup no-op", async () => {
    // A retake that will not spawn a variant must not leave the skill stuck
    // in the generating phase.
    const { deps, state } = makeDeps({
      skill: { ...SKILL, status: "GENERATING" },
      last: { id: 5, index: 3, title: "Newest lesson" },
      answeredIndex: 2,
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result.ok).toBe(true);
    expect(state.createdClasses).toHaveLength(0);
    expect(state.skillUpdates).toEqual([
      { id: 10, patch: { status: "ACTIVE" } },
    ]);
  });

  it("settles a GENERATING skill back to ACTIVE when generation fails", async () => {
    // The skill keeps its existing classes, so it returns to ACTIVE (never
    // FAILED — that means init never produced a class).
    const { deps, state } = makeDeps({
      skill: { ...SKILL, status: "GENERATING" },
      initError: { kind: "AiGenerationFailed", detail: "rate limited" },
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result.ok).toBe(false);
    expect(state.skillUpdates).toEqual([
      { id: 10, patch: { status: "ACTIVE" } },
    ]);
  });

  it("leaves a non-GENERATING skill's status alone", async () => {
    // PAUSED (or a skill still GENERATING from init) is user/init-owned:
    // the next-class pipeline must not touch it.
    const { deps, state } = makeDeps({
      skill: { ...SKILL, status: "PAUSED" },
    });

    const result = await makeGenerateNextClass(deps)({ skillId: 10, userId: 1 });

    expect(result.ok).toBe(true);
    expect(state.skillUpdates).toEqual([]);
  });
});
