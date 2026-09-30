import { describe, expect, it } from "vitest";
import {
  makeAnswerClassQuestion,
  type AnswerClassQuestionDeps,
} from "./answer-class-question";
import type { AiPort } from "@/modules/tutoring/ports";
import type { AiError } from "@/modules/tutoring/ports";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type {
  ClassQaEntity,
} from "@/modules/learning/domain/class-qa/class-qa";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";
import type {
  DomainEvent,
  EventRepository,
} from "@/modules/learning/domain/event/event.repository";
import { ok, type Result } from "@/modules/platform/result";
import { ClassQaStatus, type EventType } from "@/prisma/generated";
import { QA_TUTOR_SYSTEM } from "@/modules/tutoring/domain/personas";

const LESSON_MD = "## Introduction\nMeet the join.\n\n## Left join\nKeeps left rows.";
const CLASS = { id: 5, skillId: 10, title: "Joins", contentMd: LESSON_MD };

const pendingBlock = (overrides: Partial<ClassQaEntity> = {}): ClassQaEntity => ({
  id: 101,
  classId: 5,
  userId: 7,
  anchorParagraph: 2,
  question: "When does a left join drop rows?",
  answer: null,
  status: ClassQaStatus.PENDING,
  aiModel: null,
  createdAt: new Date("2026-09-29T00:00:00Z"),
  ...overrides,
});

type AnswerState = {
  generateTextInputs: { system: string; prompt: string }[];
  answered: { id: number; input: { answer: string; aiModel: string } }[];
  failed: number[];
  events: DomainEvent[];
};

/** Test seam: in-memory deps capturing every interaction. */
const makeDeps = (
  overrides: {
    block?: ClassQaEntity | null;
    klass?: typeof CLASS | null;
    textResult?: Result<{ raw: string }, AiError>;
  } = {},
) => {
  const state: AnswerState = {
    generateTextInputs: [],
    answered: [],
    failed: [],
    events: [],
  };

  const ai: AiPort = {
    generateJson: async () => {
      throw new Error("generateJson not used in qa tests");
    },
    generateText: async (input) => {
      state.generateTextInputs.push(input);
      return overrides.textResult ?? ok({ raw: "  Left joins drop rows when the right side has no match.  " });
    },
    generateEmbeddings: async () => {
      throw new Error("generateEmbeddings not used in qa tests");
    },
  };

  const classRepo: ClassRepository = {
    create: async () => {
      throw new Error("not used in qa tests");
    },
    listBySkill: async () => {
      throw new Error("not used in qa tests");
    },
    findTopBySkill: async () => {
      throw new Error("not used in qa tests");
    },
    findById: async () => overrides.klass === undefined ? CLASS : overrides.klass,
  };

  const qaRepo: ClassQaRepository = {
    create: async () => {
      throw new Error("not used in qa tests");
    },
    listByClass: async () => {
      throw new Error("not used in qa tests");
    },
    findById: async () => overrides.block === undefined ? pendingBlock() : overrides.block,
    answer: async (id, input) => {
      state.answered.push({ id, input });
    },
    markFailed: async (id) => {
      state.failed.push(id);
    },
    claimStranded: async () => {
      throw new Error("not used in qa tests");
    },
    failExhausted: async () => {
      throw new Error("not used in qa tests");
    },
  };

  const eventRepo: EventRepository = {
    record: async (event) => {
      state.events.push(event);
    },
  };

  const deps: AnswerClassQuestionDeps = {
    ai,
    qaRepo,
    classRepo,
    eventRepo,
    chatModel: "glm-5.3-flash",
  };
  return { deps, state };
};

describe("answerClassQuestion", () => {
  it("grounds the prompt on the lesson and persists the trimmed answer as ANSWERED", async () => {
    const { deps, state } = makeDeps();

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(state.generateTextInputs).toHaveLength(1);
    const { system, prompt } = state.generateTextInputs[0];
    expect(system).toBe(QA_TUTOR_SYSTEM);
    expect(prompt).toContain("Lesson: Joins");
    expect(prompt).toContain(LESSON_MD);
    expect(prompt).toContain("When does a left join drop rows?");
    expect(state.answered).toEqual([
      {
        id: 101,
        input: {
          answer: "Left joins drop rows when the right side has no match.",
          aiModel: "glm-5.3-flash",
        },
      },
    ]);
    expect(state.failed).toHaveLength(0);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].type).toBe("QA_ANSWERED" satisfies EventType);
    expect(state.events[0].skillId).toBe(10);
    expect(state.events[0].userId).toBe(7);
    expect(state.events[0].payload).toMatchObject({
      action: "class_qa",
      blockId: 101,
      classId: 5,
      model: "glm-5.3-flash",
      response: "Left joins drop rows when the right side has no match.",
    });
  });

  it("marks the block FAILED on AI transport failure", async () => {
    const { deps, state } = makeDeps({
      textResult: {
        ok: false,
        error: { kind: "AiGenerationFailed", detail: "upstream 500" },
      },
    });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "AiGenerationFailed", detail: "upstream 500" },
    });
    expect(state.failed).toEqual([101]);
    expect(state.answered).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("marks the block FAILED on an empty completion", async () => {
    const { deps, state } = makeDeps({
      textResult: ok({ raw: "   " }),
    });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "AiResponseInvalid", detail: "empty completion" },
    });
    expect(state.failed).toEqual([101]);
    expect(state.answered).toHaveLength(0);
  });

  it("marks the block FAILED when the class vanished", async () => {
    const { deps, state } = makeDeps({ klass: null });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "ClassNotFound", classId: 5 },
    });
    expect(state.failed).toEqual([101]);
    expect(state.generateTextInputs).toHaveLength(0);
  });

  it("no-ops on job replay of an already-answered block", async () => {
    const { deps, state } = makeDeps({
      block: pendingBlock({
        status: ClassQaStatus.ANSWERED,
        answer: "already answered",
      }),
    });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(state.generateTextInputs).toHaveLength(0);
    expect(state.answered).toHaveLength(0);
    expect(state.failed).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("no-ops when the block is gone", async () => {
    const { deps, state } = makeDeps({ block: null });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 404 });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(state.generateTextInputs).toHaveLength(0);
    expect(state.failed).toHaveLength(0);
  });
});
