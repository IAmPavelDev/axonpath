import { describe, expect, it } from "vitest";
import {
  makeGenerateInitialSkill,
  type GenerateInitialSkillDeps,
} from "./generate-initial-skill";
import type { AiError, AiUsage } from "@/modules/tutoring/ports";
import type { DomainEvent } from "@/modules/learning/domain/event/event.repository";
import type { NewVector } from "@/modules/memory/ports";
import { NextClassOptionsState, SkillMode } from "@/prisma/generated";
import { ok } from "@/modules/platform/result";

const INIT_JSON = JSON.stringify({
  classTitle: "SQL joins from zero",
  classContentMd: "## Introduction\nMeet the join.",
  lessonSummary: "This lesson introduced inner and left joins with small datasets.",
  questions: [
    {
      type: "TRUE_FALSE",
      text: "An INNER JOIN drops unmatched rows.",
      choices: ["True", "False"],
      answerKey: "True",
    },
  ],
  contextSnippets: ["First exposure to SQL joins"],
});

const DESCRIPTION_RAW = JSON.stringify({ description: "Learn SQL joins by doing." });

/** Test seam: deterministic AI adapter + in-memory persistence. */
const makeDeps = (
  overrides: {
    initRaw?: string;
    initError?: AiError;
    /** Chat usage the fake init_skill call reports (default: none — degrade). */
    initUsage?: AiUsage;
    /** Prompt tokens the fake embedding endpoint reports (default: none). */
    embeddingTokens?: number;
    existingClass?: { id: number; index: number; title: string } | null;
  } = {},
) => {
  const state = {
    skillUpdates: [] as { id: number; patch: Record<string, unknown> }[],
    createdClasses: [] as { skillId: number; index: number }[],
    createdQuestions: [] as unknown[],
    vectors: [] as NewVector[],
    events: [] as DomainEvent[],
    aiCalls: [] as { schemaName: string; prompt: string }[],
    enqueued: [] as { jobName: string; payload: unknown }[],
  };

  const deps: GenerateInitialSkillDeps = {
    ai: {
      generateJson: async (_input, request) => {
        state.aiCalls.push({ schemaName: request.schemaName, prompt: _input.prompt });
        if (request.schemaName === "skill_description") {
          return ok({ raw: DESCRIPTION_RAW });
        }
        if (overrides.initError) {
          return { ok: false, error: overrides.initError };
        }
        return ok({ raw: overrides.initRaw ?? INIT_JSON, usage: overrides.initUsage });
      },
      generateEmbeddings: async (content) =>
        ok({
          embeddings: content.map(() => [0.5]),
          usage:
            overrides.embeddingTokens !== undefined
              ? { tokens: overrides.embeddingTokens }
              : undefined,
        }),
      generateText: async () => {
        throw new Error("generateText not used in init tests");
      },
    },
    retrieveContext: async () => [],
    skillRepo: {
      create: async () => {
        throw new Error("not used in init tests");
      },
      update: async (id, patch) => {
        state.skillUpdates.push({ id, patch: { ...patch } });
        return {
          id,
          topic: "t",
          description: "d",
          status: "ACTIVE",
          mode: SkillMode.AUTOMATIC,
          optionsState: NextClassOptionsState.NONE,
          optionsStateAt: null,
        };
      },
      findById: async () => {
        throw new Error("not used in init tests");
      },
      listByUser: async () => {
        throw new Error("not used in init tests");
      },
      listByStatus: async () => {
        throw new Error("not used in init tests");
      },
    },
    classRepo: {
      findQuestionCountsByClassIds: async () => {
        throw new Error("not used in init tests");
      },
      createWithQuestions: async (cls, questions) => {
        state.createdClasses.push(cls);
        state.createdQuestions.push(...questions);
        return { id: 11 };
      },
      listBySkill: async () => {
        throw new Error("not used in init tests");
      },
      listBySkillByIndex: async () => {
        throw new Error("not used in init tests");
      },
      listByIds: async () => {
        throw new Error("not used in init tests");
      },
      findTopBySkill: async () => overrides.existingClass ?? null,
      findById: async () => {
        throw new Error("not used in init tests");
      },
    },
    quizRepo: {
      findWrongAnswersBySkill: async () => {
        throw new Error("not used in init tests");
      },
      findReviewCandidatesBySkill: async () => {
        throw new Error("not used in init tests");
      },
      findByClassId: async () => {
        throw new Error("not used in init tests");
      },
      findAnswerActivityByUser: async () => {
        throw new Error("not used in init tests");
      },
      findScoreableByClassId: async () => {
        throw new Error("not used in init tests");
      },
      createAnswers: async () => {
        throw new Error("not used in init tests");
      },
      findHighestAnsweredClassIndex: async () => {
        throw new Error("not used in init tests");
      },
      findAnswersByClassAndUser: async () => {
        throw new Error("not used in init tests");
      },
      findAnswerStatsBySkill: async () => {
        throw new Error("not used in init tests");
      },
      findAnswersWithQuestions: async () => {
        throw new Error("not used in init tests");
      },
      updateGrades: async () => {
        throw new Error("not used in init tests");
      },
    },
    eventRepo: {
      findUsageEvents: async () => [],
      record: async (event) => {
        state.events.push(event);
      },
    },
    recordVectors: async (vectors) => {
      state.vectors.push(...vectors);
      return ok(vectors.map((_, i) => i));
    },
    chatModel: "glm-5.3-flash",
    jobs: {
      enqueue: (jobName, payload) => {
        state.enqueued.push({ jobName, payload });
      },
    },
  };

  return { deps, state };
};

describe("makeGenerateInitialSkill", () => {
  const input = { skillId: 10, userId: 1, topic: "SQL joins" };

  it("writes the summary vector as AI_NEXT and snippets as AI_INITIAL, then flips ACTIVE", async () => {
    const { deps, state } = makeDeps();

    const result = await makeGenerateInitialSkill(deps)(input);

    expect(result.ok).toBe(true);
    // Status lifecycle: description update first, ACTIVE on success last.
    expect(state.skillUpdates.at(-1)).toEqual({ id: 10, patch: { status: "ACTIVE" } });

    // One embedding batch: lesson summary (AI_NEXT) first, snippet (AI_INITIAL) after.
    expect(state.vectors).toHaveLength(2);
    expect(state.vectors[0]).toMatchObject({
      source: "AI_NEXT",
      classIndex: 0,
      classId: 11,
      skillId: 10,
      userId: 1,
    });
    expect(state.vectors[0]?.textSnippet).toContain("inner and left joins");
    expect(state.vectors[1]).toMatchObject({ source: "AI_INITIAL", classIndex: 0 });

    // Composite persist: the class and its questions go out in one call.
    expect(state.createdClasses[0]).toMatchObject({
      skillId: 10,
      index: 0,
      aiModel: "glm-5.3-flash",
    });
    expect(state.createdQuestions).toEqual([
      {
        type: "TRUE_FALSE",
        text: "An INNER JOIN drops unmatched rows.",
        choices: ["True", "False"],
        answerKey: "True",
        aiModel: "glm-5.3-flash",
      },
    ]);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      skillId: 10,
      userId: 1,
      type: "SKILL_CREATED",
    });
    // Conspect memory rides the fire-and-forget queue with the fresh class id.
    expect(state.enqueued).toEqual([
      { jobName: "class-content-vectors", payload: { classId: 11 } },
    ]);
  });

  it("generates and normalizes OPEN_ENDED questions, and instructs the model to include them", async () => {
    // The scripted model drifts: it echoes example choices on an open-ended
    // question. The normalizer must force choices: [] and keep the model
    // answer.
    const initRaw = JSON.stringify({
      classTitle: "SQL joins from zero",
      classContentMd: "## Introduction\nMeet the join.",
      lessonSummary: "This lesson introduced inner and left joins.",
      questions: [
        {
          type: "TRUE_FALSE",
          text: "An INNER JOIN drops unmatched rows.",
          choices: ["True", "False"],
          answerKey: "True",
        },
        {
          type: "OPEN_ENDED",
          text: "Explain why an INNER JOIN drops unmatched rows.",
          choices: ["Left Join", "Right Join"],
          answerKey: "Rows without a match in the other table fail the join predicate.",
        },
      ],
      contextSnippets: ["First exposure to SQL joins"],
    });
    const { deps, state } = makeDeps({ initRaw });

    const result = await makeGenerateInitialSkill(deps)(input);

    expect(result.ok).toBe(true);
    expect(state.createdQuestions[1]).toEqual({
      type: "OPEN_ENDED",
      text: "Explain why an INNER JOIN drops unmatched rows.",
      choices: [],
      answerKey: "Rows without a match in the other table fail the join predicate.",
      aiModel: "glm-5.3-flash",
    });
    // The unlock instruction reaches the model in the init prompt.
    const initPrompt = state.aiCalls.find((call) => call.schemaName === "init_skill");
    expect(initPrompt?.prompt).toContain(
      "Include 1–2 open-ended questions per lesson (type OPEN_ENDED, choices: [], answerKey: a model answer)",
    );
  });

  it("flips FAILED and audits ERROR_OCCURRED when generation fails", async () => {
    const { deps, state } = makeDeps({
      initError: { kind: "AiGenerationFailed", detail: "timeout" },
    });

    const result = await makeGenerateInitialSkill(deps)(input);

    expect(result.ok).toBe(false);
    expect(state.skillUpdates.at(-1)).toEqual({ id: 10, patch: { status: "FAILED" } });
    expect(state.events).toEqual([
      {
        skillId: 10,
        userId: 1,
        type: "ERROR_OCCURRED",
        payload: {
          action: "init_skill",
          error: { kind: "AiGenerationFailed", detail: "timeout" },
        },
      },
    ]);
    expect(state.createdClasses).toHaveLength(0);
    expect(state.vectors).toHaveLength(0);
  });

  it("flips FAILED on unparseable model output", async () => {
    const { deps, state } = makeDeps({ initRaw: "Sure — here is your lesson, no JSON though!" });

    const result = await makeGenerateInitialSkill(deps)(input);
    if (!result.ok) expect(result.error.kind).toBe("AiResponseInvalid");
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: "FAILED" });
    expect(state.createdClasses).toHaveLength(0);
    expect(state.events[0]?.type).toBe("ERROR_OCCURRED");
  });

  it("retry after a partial persist skips generation and heals to ACTIVE", async () => {
    // A prior attempt failed after class 0 was persisted (e.g. embeddings
    // errored): regenerating would violate UNIQUE(skillId, index). The guard
    // short-circuits — no AI calls at all — and the wrapper flips ACTIVE.
    const { deps, state } = makeDeps({
      initError: { kind: "AiGenerationFailed" },
      existingClass: { id: 11, index: 0, title: "Already-persisted lesson" },
    });

    const result = await makeGenerateInitialSkill(deps)(input);

    expect(result.ok).toBe(true);
    expect(state.aiCalls).toHaveLength(0);
    expect(state.createdClasses).toHaveLength(0);
    expect(state.vectors).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.skillUpdates.at(-1)).toEqual({ id: 10, patch: { status: "ACTIVE" } });
  });

  it("retry after a pre-persist failure regenerates from scratch", async () => {
    // Nothing was persisted, so the guard passes through and the full
    // pipeline runs again (description + init generation).
    const { deps, state } = makeDeps();

    const result = await makeGenerateInitialSkill(deps)(input);

    expect(result.ok).toBe(true);
    expect(state.aiCalls.map((call) => call.schemaName)).toEqual([
      "skill_description",
      "init_skill",
    ]);
    expect(state.createdClasses[0]).toMatchObject({ index: 0 });
    expect(state.skillUpdates.at(-1)).toEqual({ id: 10, patch: { status: "ACTIVE" } });
  });
  it("audits chat usage on SKILL_CREATED and attributes embedding tokens to vectors", async () => {
    const { deps, state } = makeDeps({
      initUsage: { promptTokens: 500, completionTokens: 900 },
      embeddingTokens: 100,
    });

    const result = await makeGenerateInitialSkill(deps)(input);

    expect(result.ok).toBe(true);
    const payload = state.events[0]?.payload as {
      usage?: unknown;
      response?: unknown;
    };
    // The init_skill call's billed usage and raw generation text ride the audit row.
    expect(payload.usage).toEqual({ promptTokens: 500, completionTokens: 900 });
    expect(payload.response).toEqual(INIT_JSON);
    // The batch total splits across summary + snippet vectors, sum preserved.
    expect(state.vectors.map((vector) => vector.tokenCount)).toEqual([50, 50]);
  });

  it("omits usage when the adapter reports none (tokenCount stays null)", async () => {
    const { deps, state } = makeDeps();

    const result = await makeGenerateInitialSkill(deps)(input);

    expect(result.ok).toBe(true);
    const payload = state.events[0]?.payload as { usage?: unknown };
    expect(payload.usage).toBeUndefined();
    expect(state.vectors.map((vector) => vector.tokenCount)).toEqual([null, null]);
  });
});
