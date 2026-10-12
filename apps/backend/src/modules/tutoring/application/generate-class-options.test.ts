import { describe, expect, it } from "vitest";
import {
  EventType,
  NextClassOptionsState,
  SkillMode,
  SkillStatus,
} from "@/prisma/generated";
import {
  makeGenerateClassOptions,
  type GenerateClassOptionsDeps,
} from "./generate-class-options";
import type { AiError, AiUsage } from "@/modules/tutoring/ports";
import type { DomainEvent } from "@/modules/learning/domain/event/event.repository";
import { makeSystemClock } from "@/modules/platform/ports/clock";
import { ok } from "@/modules/platform/result";

type SkillFake = {
  id: number;
  userId: number;
  topic: string;
  description: string;
  status: SkillStatus;
  mode: SkillMode;
  optionsState: NextClassOptionsState;
  optionsStateAt: Date | null;
};

const SKILL: SkillFake = {
  id: 10,
  userId: 7,
  topic: "SQL joins",
  description: "",
  status: SkillStatus.ACTIVE,
  mode: SkillMode.MANUAL,
  optionsState: NextClassOptionsState.PENDING,
  optionsStateAt: new Date(),
};

const OPTIONS_JSON = JSON.stringify({
  targets: [
    "Practice LEFT JOIN queries with unmatched rows",
    "Compare INNER and LEFT JOIN on the same tables",
    "Aggregate joined results with GROUP BY",
  ],
});

type OptionsState = {
  prompts: string[];
  replacements: Array<{
    skillId: number;
    options: Array<{ rank: number; text: string }>;
  }>;
  skillUpdates: { id: number; patch: Record<string, unknown> }[];
  events: DomainEvent[];
  cleared: number[];
};

const makeDeps = (
  overrides: {
    skill?: typeof SKILL | null;
    last?: { id: number; index: number; title: string } | null;
    raw?: string;
    aiError?: AiError;
    usage?: AiUsage;
  } = {},
) => {
  const state: OptionsState = {
    prompts: [],
    replacements: [],
    skillUpdates: [],
    events: [],
    cleared: [],
  };

  const deps: GenerateClassOptionsDeps = {
    recordAiAttempt: () => {},
    ai: {
      generateJson: async (input, request) => {
        if (request.schemaName === "class_options") {
          if (overrides.aiError) {
            return { ok: false, error: overrides.aiError };
          }
          state.prompts.push(input.prompt);
          return ok({
            raw: overrides.raw ?? OPTIONS_JSON,
            usage: overrides.usage,
          });
        }
        throw new Error(`unexpected schema ${request.schemaName}`);
      },
      generateEmbeddings: async () => {
        throw new Error("generateEmbeddings not used in class-options tests");
      },
      generateText: async () => {
        throw new Error("generateText not used in class-options tests");
      },
    },
    retrieveContext: async () => [],
    skillRepo: {
      create: async () => {
        throw new Error("create not used in class-options tests");
      },
      update: async (id, patch) => {
        state.skillUpdates.push({ id, patch });
        return {
          id,
          topic: SKILL.topic,
          description: "",
          status: SKILL.status,
          mode: SKILL.mode,
          optionsState:
            (patch.optionsState as NextClassOptionsState) ?? SKILL.optionsState,
          optionsStateAt: (patch.optionsStateAt as Date | null) ?? null,
        };
      },
      findById: async () =>
        overrides.skill === undefined ? SKILL : overrides.skill,
      listByUser: async () => [],
      listByStatus: async () => [],
      claimStaleInit: async () => [],
      listStalePendingOptions: async () => [],
    },
    optionRepo: {
      replaceForSkill: async (skillId, options) => {
        state.replacements.push({ skillId, options });
      },
      clearForSkill: async (skillId) => {
        state.cleared.push(skillId);
      },
      listBySkill: async () => [],
    },
    classRepo: {
      findQuestionCountsByClassIds: async () => [],
      createWithQuestions: async () => ({ id: 1 }),
      listBySkill: async () => [],
      listBySkillByIndex: async () => [],
      listByIds: async () => [],
      findTopBySkill: async () =>
        overrides.last === undefined
          ? { id: 5, index: 2, title: "Previous lesson" }
          : overrides.last,
      findById: async () => null,
    },
    quizRepo: {
      findLatestAttemptResults: async () => [],
      listPendingGradingIds: async () => [],
      findReviewCandidatesBySkill: async () => [],
      findByClassId: async () => [],
      findScoreableByClassId: async () => [],
      createAnswers: async () => [],
      findAnswersByClassAndUser: async () => [],
      findHighestAnsweredClassIndex: async () => null,
      findAnswerStatsBySkill: async () => [],
      findAnswersWithQuestions: async () => [],
      updateGrades: async () => {},
      findWrongAnswersBySkill: async () => [],
      findAnswerActivityByUser: async () => [],
    },
    eventRepo: {
      record: async (event) => {
        state.events.push(event);
      },
      findUsageEvents: async () => [],
    },
    clock: makeSystemClock(),
  };
  return { deps, state };
};

describe("generateClassOptions", () => {
  it("proposes three ranked targets for an ACTIVE skill and settles READY", async () => {
    const { deps, state } = makeDeps();
    const result = await makeGenerateClassOptions(deps)({
      skillId: 10,
      userId: 7,
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(state.replacements).toHaveLength(1);
    expect(state.replacements[0].options.map((option) => option.rank)).toEqual([
      1, 2, 3,
    ]);
    expect(state.replacements[0].options[0].text).toContain("LEFT JOIN");
    expect(state.skillUpdates).toContainEqual({
      id: 10,
      patch: {
        optionsState: NextClassOptionsState.READY,
        optionsStateAt: expect.any(Date),
      },
    });
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: EventType.CLASS_OPTIONS_GENERATED }),
    );
  });

  it("builds a first-lesson prompt when the skill has no classes yet", async () => {
    const { deps, state } = makeDeps({ last: null });
    const result = await makeGenerateClassOptions(deps)({
      skillId: 10,
      userId: 7,
    });

    expect(result.ok).toBe(true);
    expect(state.prompts).toHaveLength(1);
    expect(state.prompts[0]).toContain("SQL joins");
    expect(state.prompts[0]).not.toContain("Previous lesson");
  });

  it("includes last-lesson context when classes exist", async () => {
    const { deps, state } = makeDeps();
    await makeGenerateClassOptions(deps)({ skillId: 10, userId: 7 });

    expect(state.prompts[0]).toContain("Previous lesson");
    expect(state.prompts[0]).toContain("Previous lesson");
  });

  it("no-ops for a non-ACTIVE skill and rewinds a dangling PENDING", async () => {
    const paused = { ...SKILL, status: SkillStatus.PAUSED };
    const { deps, state } = makeDeps({ skill: paused });
    const result = await makeGenerateClassOptions(deps)({
      skillId: 10,
      userId: 7,
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(state.prompts).toEqual([]);
    expect(state.skillUpdates).toContainEqual({
      id: 10,
      patch: { optionsState: NextClassOptionsState.NONE, optionsStateAt: null },
    });

    const readySkill = { ...paused, optionsState: NextClassOptionsState.READY };
    const ready = makeDeps({ skill: readySkill });
    await makeGenerateClassOptions(ready.deps)({ skillId: 10, userId: 7 });
    expect(ready.state.skillUpdates).toEqual([]);
  });

  it("marks FAILED and records ERROR_OCCURRED when generation fails", async () => {
    const { deps, state } = makeDeps({
      aiError: { kind: "AiGenerationFailed", detail: "down" },
    });
    const result = await makeGenerateClassOptions(deps)({
      skillId: 10,
      userId: 7,
    });

    expect(result.ok).toBe(false);
    expect(state.skillUpdates).toContainEqual({
      id: 10,
      patch: {
        optionsState: NextClassOptionsState.FAILED,
        optionsStateAt: expect.any(Date),
      },
    });
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: EventType.ERROR_OCCURRED }),
    );
    expect(state.replacements).toEqual([]);
  });

  it("marks FAILED on a malformed or empty target set", async () => {
    const malformed = makeDeps({ raw: "not json at all" });
    const malformedResult = await makeGenerateClassOptions(malformed.deps)({
      skillId: 10,
      userId: 7,
    });
    expect(malformedResult.ok).toBe(false);
    expect(malformed.state.skillUpdates).toContainEqual(
      expect.objectContaining({
        patch: expect.objectContaining({
          optionsState: NextClassOptionsState.FAILED,
        }),
      }),
    );

    const empty = makeDeps({ raw: JSON.stringify({ targets: [] }) });
    const emptyResult = await makeGenerateClassOptions(empty.deps)({
      skillId: 10,
      userId: 7,
    });
    expect(emptyResult.ok).toBe(false);
    expect(empty.state.replacements).toEqual([]);
  });

  it("caps targets at three and drops non-string entries", async () => {
    const { deps, state } = makeDeps({
      raw: JSON.stringify({ targets: ["a", 42, "b", "c", "d"] }),
    });
    const result = await makeGenerateClassOptions(deps)({
      skillId: 10,
      userId: 7,
    });

    expect(result.ok).toBe(true);
    expect(state.replacements[0].options.map((option) => option.text)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
