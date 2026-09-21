import { describe, expect, it } from "vitest";
import {
  makeGenerateInitialSkill,
  type GenerateInitialSkillDeps,
} from "./generate-initial-skill";
import type { AiError } from "@/modules/tutoring/ports";
import type { DomainEvent } from "@/modules/learning/domain/event/event.repository";
import type { NewVector } from "@/modules/memory/ports";
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
const makeDeps = (overrides: { initRaw?: string; initError?: AiError } = {}) => {
  const state = {
    skillUpdates: [] as { id: number; patch: Record<string, unknown> }[],
    createdClasses: [] as { skillId: number; index: number }[],
    vectors: [] as NewVector[],
    events: [] as DomainEvent[],
  };

  const deps: GenerateInitialSkillDeps = {
    ai: {
      generateJson: async (_input, request) => {
        if (request.schemaName === "skill_description") {
          return ok({ raw: DESCRIPTION_RAW });
        }
        if (overrides.initError) {
          return { ok: false, error: overrides.initError };
        }
        return ok({ raw: overrides.initRaw ?? INIT_JSON });
      },
      generateEmbeddings: async (content) => ok(content.map(() => [0.5])),
    },
    retrieveContext: async () => [],
    skillRepo: {
      create: async () => {
        throw new Error("not used in init tests");
      },
      update: async (id, patch) => {
        state.skillUpdates.push({ id, patch: { ...patch } });
        return { id, topic: "t", description: "d", status: "ACTIVE" };
      },
      findById: async () => {
        throw new Error("not used in init tests");
      },
      listByUser: async () => {
        throw new Error("not used in init tests");
      },
    },
    classRepo: {
      create: async (input) => {
        state.createdClasses.push(input);
        return { id: 11 };
      },
      listBySkill: async () => {
        throw new Error("not used in init tests");
      },
      findTopBySkill: async () => {
        throw new Error("not used in init tests");
      },
      findById: async () => {
        throw new Error("not used in init tests");
      },
    },
    quizRepo: {
      createQuestions: async () => [1],
      findByClassId: async () => {
        throw new Error("not used in init tests");
      },
      findScoreableByClassId: async () => {
        throw new Error("not used in init tests");
      },
      createAnswers: async () => {
        throw new Error("not used in init tests");
      },
      findAnswersByClassAndUser: async () => {
        throw new Error("not used in init tests");
      },
    },
    eventRepo: {
      record: async (event) => {
        state.events.push(event);
      },
    },
    recordVectors: async (vectors) => {
      state.vectors.push(...vectors);
      return ok(vectors.map((_, i) => i));
    },
    chatModel: "glm-5.3-flash",
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

    expect(state.createdClasses[0]).toMatchObject({
      skillId: 10,
      index: 0,
      aiModel: "glm-5.3-flash",
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      skillId: 10,
      userId: 1,
      type: "SKILL_CREATED",
    });
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

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AiResponseInvalid");
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: "FAILED" });
    expect(state.createdClasses).toHaveLength(0);
    expect(state.events[0]?.type).toBe("ERROR_OCCURRED");
  });
});
