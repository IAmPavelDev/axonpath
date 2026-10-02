import { describe, expect, it } from "vitest";
import { schema } from "@axon/api-contract";
import {
  makeAskClassQuestion,
  type AskClassQuestionDeps,
} from "./ask-class-question";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type {
  ClassQaEntity,
} from "@/modules/learning/domain/class-qa/class-qa";
import type {
  ClassQaRepository,
  NewClassQaBlock,
} from "@/modules/learning/domain/class-qa/class-qa.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  ClassQaStatus,
  NextClassOptionsState,
  SkillMode,
} from "@/prisma/generated";

const CLASS = { id: 5, skillId: 10, index: 0, title: "Joins", contentMd: "## Intro" };
const SKILL = {
  id: 10,
  userId: 7,
  topic: "SQL",
  description: "",
  status: "ACTIVE",
  mode: SkillMode.AUTOMATIC,
  optionsState: NextClassOptionsState.NONE,
  optionsStateAt: null,
};

type AskState = {
  created: NewClassQaBlock[];
  enqueued: { jobName: string; payload: unknown }[];
};

/** Test seam: in-memory deps capturing every interaction. */
const makeDeps = (
  overrides: {
    klass?: typeof CLASS | null;
    skill?: typeof SKILL | null;
  } = {},
) => {
  const state: AskState = { created: [], enqueued: [] };
  let blockSeq = 100;

  const classRepo: ClassRepository = {
    findQuestionCountsByClassIds: async () => {
      throw new Error("not used in ask tests");
    },
    createWithQuestions: async () => {
      throw new Error("not used in ask tests");
    },
    listBySkill: async () => {
      throw new Error("not used in ask tests");
    },
    listBySkillByIndex: async () => {
      throw new Error("not used in ask tests");
    },
    listByIds: async () => {
      throw new Error("not used in ask tests");
    },
    findTopBySkill: async () => {
      throw new Error("not used in ask tests");
    },
    findById: async () => overrides.klass === undefined ? CLASS : overrides.klass,
  };

  const skillRepo: SkillRepository = {
    create: async () => {
      throw new Error("not used in ask tests");
    },
    update: async () => {
      throw new Error("not used in ask tests");
    },
    findById: async () => overrides.skill === undefined ? SKILL : overrides.skill,
    listByUser: async () => {
      throw new Error("not used in ask tests");
    },
    listByStatus: async () => {
      throw new Error("not used in ask tests");
    },
  };

  const qaRepo: ClassQaRepository = {
    create: async (input) => {
      state.created.push(input);
      const entity: ClassQaEntity = {
        id: ++blockSeq,
        ...input,
        anchorText: input.anchorText ?? null,
        answer: null,
        status: ClassQaStatus.PENDING,
        aiModel: null,
        createdAt: new Date("2026-09-29T00:00:00Z"),
      };
      return { id: entity.id, status: entity.status };
    },
    listByClass: async () => {
      throw new Error("not used in ask tests");
    },
    listAnsweredByClass: async () => {
      throw new Error("not used in ask tests");
    },
    findById: async () => {
      throw new Error("not used in ask tests");
    },
    answer: async () => {
      throw new Error("not used in ask tests");
    },
    markFailed: async () => {
      throw new Error("not used in ask tests");
    },
    claimStranded: async () => {
      throw new Error("not used in ask tests");
    },
    failExhausted: async () => {
      throw new Error("not used in ask tests");
    },
  };

  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      state.enqueued.push({ jobName, payload });
    },
  };

  const deps: AskClassQuestionDeps = { classRepo, skillRepo, qaRepo, jobs };
  return { deps, state };
};

describe("askClassQuestion", () => {
  it("creates a PENDING block and enqueues the answer job", async () => {
    const { deps, state } = makeDeps();

    const result = await makeAskClassQuestion(deps)({
      classId: 5,
      userId: 7,
      anchorParagraph: 3,
      question: "What is a left join?",
    });

    expect(result).toEqual({
      ok: true,
      value: { blockId: 101, status: "PENDING" },
    });
    expect(state.created).toEqual([
      {
        classId: 5,
        userId: 7,
        anchorParagraph: 3,
        anchorText: null,
        question: "What is a left join?",
      },
    ]);
    expect(state.enqueued).toEqual([
      { jobName: "class-qa-answer", payload: { blockId: 101 } },
    ]);
  });

  it("stores the verbatim selection as the anchor text", async () => {
    const { deps, state } = makeDeps();

    const result = await makeAskClassQuestion(deps)({
      classId: 5,
      userId: 7,
      anchorParagraph: 2,
      anchorText: "a left join keeps every left row",
      question: "Why keep unmatched rows?",
    });

    expect(result).toEqual({
      ok: true,
      value: { blockId: 101, status: "PENDING" },
    });
    expect(state.created).toEqual([
      {
        classId: 5,
        userId: 7,
        anchorParagraph: 2,
        anchorText: "a left join keeps every left row",
        question: "Why keep unmatched rows?",
      },
    ]);
  });

  it("returns ClassNotFound for an unknown class without creating or enqueuing", async () => {
    const { deps, state } = makeDeps({ klass: null });

    const result = await makeAskClassQuestion(deps)({
      classId: 999,
      userId: 7,
      anchorParagraph: 0,
      question: "Hello?",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "ClassNotFound", classId: 999 },
    });
    expect(state.created).toHaveLength(0);
    expect(state.enqueued).toHaveLength(0);
  });

  it("returns NotOwned without creating or enqueuing when the skill belongs to another user", async () => {
    const { deps, state } = makeDeps();

    const result = await makeAskClassQuestion(deps)({
      classId: 5,
      userId: 99,
      anchorParagraph: 0,
      question: "Hello?",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "NotOwned", skillId: 10 },
    });
    expect(state.created).toHaveLength(0);
    expect(state.enqueued).toHaveLength(0);
  });
});

describe("AskClassQuestionInput contract", () => {
  const base = { classId: 5, anchorParagraph: 2 };

  it("accepts and trims a normal question", () => {
    const parsed = schema.class.AskClassQuestionInput.safeParse({
      ...base,
      question: "  What is a join?  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.question).toBe("What is a join?");
    }
  });

  it("rejects an empty or whitespace-only question", () => {
    expect(
      schema.class.AskClassQuestionInput.safeParse({ ...base, question: "" })
        .success,
    ).toBe(false);
    expect(
      schema.class.AskClassQuestionInput.safeParse({ ...base, question: "   " })
        .success,
    ).toBe(false);
  });

  it("rejects oversized questions", () => {
    expect(
      schema.class.AskClassQuestionInput.safeParse({
        ...base,
        question: "a".repeat(4001),
      }).success,
    ).toBe(false);
  });

  it("rejects a negative or fractional anchorParagraph", () => {
    expect(
      schema.class.AskClassQuestionInput.safeParse({
        ...base,
        anchorParagraph: -1,
        question: "q",
      }).success,
    ).toBe(false);
    expect(
      schema.class.AskClassQuestionInput.safeParse({
        ...base,
        anchorParagraph: 1.5,
        question: "q",
      }).success,
    ).toBe(false);
  });

  it("treats anchorText as optional and trims it when present", () => {
    const without = schema.class.AskClassQuestionInput.safeParse({
      ...base,
      question: "q",
    });
    expect(without.success).toBe(true);
    if (without.success) {
      expect(without.data.anchorText).toBeUndefined();
    }

    const withText = schema.class.AskClassQuestionInput.safeParse({
      ...base,
      anchorText: "  selected passage  ",
      question: "q",
    });
    expect(withText.success).toBe(true);
    if (withText.success) {
      expect(withText.data.anchorText).toBe("selected passage");
    }
  });

  it("rejects an empty or oversized anchorText", () => {
    expect(
      schema.class.AskClassQuestionInput.safeParse({
        ...base,
        anchorText: "",
        question: "q",
      }).success,
    ).toBe(false);
    expect(
      schema.class.AskClassQuestionInput.safeParse({
        ...base,
        anchorText: "a".repeat(2001),
        question: "q",
      }).success,
    ).toBe(false);
    expect(
      schema.class.AskClassQuestionInput.safeParse({
        ...base,
        anchorText: "a".repeat(2000),
        question: "q",
      }).success,
    ).toBe(true);
  });
});
