import { describe, expect, it } from "vitest";
import {
  makeAnswerClassQuestion,
  type AnswerClassQuestionDeps,
} from "./answer-class-question";
import { CLASS_CONTENT_VECTORS_JOB } from "@/modules/memory/application/vectorize-class-content";
import { QA_BLOCK_VECTORS_JOB } from "@/modules/memory/application/mine-qa-vectors";
import type { AiError, AiPort, TextGenerationResult } from "@/modules/tutoring/ports";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassQaEntity } from "@/modules/learning/domain/class-qa/class-qa";
import type {
  ClassQaRepository,
  NewClassQaBlock,
} from "@/modules/learning/domain/class-qa/class-qa.repository";
import type {
  DomainEvent,
  EventRepository,
} from "@/modules/learning/domain/event/event.repository";
import type {
  QaContextHits,
  RetrieveQaContext,
} from "@/modules/memory/application/retrieve-qa-context";
import { ok } from "@/modules/platform/result";
import { ClassQaStatus, type EventType } from "@/prisma/generated";
import { QA_TUTOR_SYSTEM } from "@/modules/tutoring/domain/personas";

const LESSON_MD =
  "## Introduction\nMeet the join.\n\n## Left join\nKeeps left rows.\n\n## Summary\nJoins filter rows.";
const CLASS = { id: 5, skillId: 10, index: 2, title: "Joins", contentMd: LESSON_MD };
const SKILL = {
  id: 10,
  userId: 7,
  topic: "SQL joins",
  description: "Learn SQL joins by doing.",
  status: "ACTIVE",
};

const pendingBlock = (overrides: Partial<ClassQaEntity> = {}): ClassQaEntity => ({
  id: 101,
  classId: 5,
  userId: 7,
  anchorParagraph: 1,
  anchorText: null,
  question: "When does a left join drop rows?",
  answer: null,
  status: ClassQaStatus.PENDING,
  aiModel: null,
  createdAt: new Date("2026-09-29T00:00:00Z"),
  ...overrides,
});

const answeredBlock = (overrides: Partial<ClassQaEntity> = {}): ClassQaEntity =>
  pendingBlock({
    id: 100,
    status: ClassQaStatus.ANSWERED,
    answer: "A left join keeps every left row.",
    ...overrides,
  });

type AnswerState = {
  generateTextInputs: { system: string; prompt: string }[];
  answered: { id: number; input: { answer: string; aiModel: string } }[];
  failed: number[];
  events: DomainEvent[];
  backfilledClassIds: number[];
  retrievalQueries: string[];
  enqueued: { jobName: string; payload: unknown }[];
};

/** Test seam: in-memory deps capturing every interaction. */
const makeDeps = (
  overrides: {
    block?: ClassQaEntity | null;
    klass?: typeof CLASS | null;
    skill?: typeof SKILL | null;
    history?: ClassQaEntity[];
    hits?: QaContextHits;
    textResult?: TextGenerationResult;
    textError?: AiError;
  } = {},
) => {
  const state: AnswerState = {
    generateTextInputs: [],
    answered: [],
    failed: [],
    events: [],
    backfilledClassIds: [],
    retrievalQueries: [],
    enqueued: [],
  };

  const ai: AiPort = {
    generateText: async (input) => {
      state.generateTextInputs.push(input);
      if (overrides.textError) {
        return { ok: false as const, error: overrides.textError };
      }
      return ok(
        overrides.textResult ?? {
          raw: "A left join keeps unmatched rows.",
          usage: undefined,
        },
      );
    },
    generateJson: async () => {
      throw new Error("generateJson not used in QA answer tests");
    },
    generateEmbeddings: async () => {
      throw new Error("generateEmbeddings not used in QA answer tests");
    },
  };

  const qaRepo: ClassQaRepository = {
    create: async (_input: NewClassQaBlock) => {
      throw new Error("not used in answer tests");
    },
    listByClass: async () => {
      throw new Error("not used in answer tests");
    },
    listAnsweredByClass: async (_classId, limit) =>
      (overrides.history ?? []).slice(0, limit),
    findById: async (id) => {
      if (overrides.block !== undefined) return overrides.block;
      return id === 101 ? pendingBlock() : null;
    },
    answer: async (id, input) => {
      state.answered.push({ id, input });
    },
    markFailed: async (id) => {
      state.failed.push(id);
    },
    claimStranded: async () => {
      throw new Error("not used in answer tests");
    },
    failExhausted: async () => {
      throw new Error("not used in answer tests");
    },
  };

  const classRepo: ClassRepository = {
    findQuestionCountsByClassIds: async () => {
      throw new Error("not used in answer tests");
    },
    createWithQuestions: async () => {
      throw new Error("not used in answer tests");
    },
    listBySkill: async () => {
      throw new Error("not used in answer tests");
    },
    listBySkillByIndex: async () => [
      { id: 5, index: 2, title: "Joins", questionCount: 3 },
      { id: 6, index: 3, title: "Aggregates", questionCount: 2 },
    ],
    listByIds: async () => {
      throw new Error("not used in answer tests");
    },
    findTopBySkill: async () => {
      throw new Error("not used in answer tests");
    },
    findById: async () => (overrides.klass === undefined ? CLASS : overrides.klass),
  };

  const skillRepo: SkillRepository = {
    create: async () => {
      throw new Error("not used in answer tests");
    },
    update: async () => {
      throw new Error("not used in answer tests");
    },
    findById: async () => (overrides.skill === undefined ? SKILL : overrides.skill),
    listByUser: async () => {
      throw new Error("not used in answer tests");
    },
    listByStatus: async () => {
      throw new Error("not used in answer tests");
    },
  };

  const eventRepo: EventRepository = {
    findUsageEvents: async () => [],
    record: async (event) => {
      state.events.push(event);
    },
  };

  const retrieveQaContext: RetrieveQaContext = async (input) => {
    state.retrievalQueries.push(input.query);
    return overrides.hits ?? { skillHits: [], crossHits: [] };
  };

  const vectorizeClassContent = async (input: { classId: number }) => {
    state.backfilledClassIds.push(input.classId);
    return ok(undefined);
  };

  const jobs = {
    enqueue: (jobName: string, payload: unknown) => {
      state.enqueued.push({ jobName, payload });
    },
  };

  const deps: AnswerClassQuestionDeps = {
    ai,
    qaRepo,
    classRepo,
    skillRepo,
    eventRepo,
    chatModel: "glm-5.3-flash",
    retrieveQaContext,
    vectorizeClassContent,
    jobs,
  };
  return { deps, state };
};

describe("answerClassQuestion", () => {
  it("renders the layered prompt with quote, lesson, history, skill frame and memory", async () => {
    const { deps, state } = makeDeps({
      block: pendingBlock({
        anchorText: "a left join keeps every left row",
      }),
      history: [
        answeredBlock({
          id: 100,
          anchorParagraph: 0,
          anchorText: "Meet the join.",
          question: "What is a join?",
        }),
      ],
      hits: {
        skillHits: [
          { vectorId: 1, score: 0.9, textSnippet: "Notes on outer joins", source: "CONTENT_CHUNK", classIndex: 1, tokenCount: null },
        ],
        crossHits: [
          { vectorId: 2, score: 0.8, textSnippet: "Already comfortable with SELECT filters", source: "AI_INITIAL", classIndex: null, tokenCount: null },
        ],
      },
    });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({ ok: true, value: undefined });
    const { system, prompt } = state.generateTextInputs[0];
    expect(system).toBe(QA_TUTOR_SYSTEM);
    expect(prompt.indexOf("Document model")).toBeLessThan(prompt.indexOf("The learner typed:"));
    expect(prompt).toContain("The learner selected this passage from the lesson");
    expect(prompt).toContain('"""a left join keeps every left row"""');
    expect(prompt).toContain("(anchor: paragraph 1)");
    expect(prompt).toContain('The learner typed:\n"""When does a left join drop rows?"""');
    expect(prompt).toContain(LESSON_MD);
    expect(prompt).toContain("Skill: SQL joins — Learn SQL joins by doing.");
    expect(prompt).toContain("Other lessons in this skill: Aggregates");
    // L3: anchored annotation with per-line author tags.
    expect(prompt).toContain('— Passage: "Meet the join."');
    expect(prompt).toContain('The learner typed: """What is a join?"""');
    expect(prompt).toContain('You answered: """A left join keeps every left row."""');
    // L5: labeled background memory after the lesson.
    expect(prompt).toContain("Background memory from this learner's other lessons and skills, written by Axon");
    expect(prompt).toContain("- Notes on outer joins");
    expect(prompt).toContain("- Already comfortable with SELECT filters");
  });

  it("falls back to the anchored chunk's excerpt when no selection was stored", async () => {
    const { deps, state } = makeDeps();

    await makeAnswerClassQuestion(deps)({ blockId: 101 });

    const prompt = state.generateTextInputs[0].prompt;
    expect(prompt).toContain('"""Left join Keeps left rows."""');
    // The retrieval query embeds the selection when present, else the question.
    expect(state.retrievalQueries[0]).toBe("When does a left join drop rows?");
  });

  it("embeds the selection together with the question as the retrieval query", async () => {
    const { deps, state } = makeDeps({
      block: pendingBlock({ anchorText: "Keeps left rows." }),
    });

    await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(state.retrievalQueries[0]).toBe(
      "When does a left join drop rows?\nKeeps left rows.",
    );
  });

  it("skips empty optional layers instead of failing", async () => {
    const { deps, state } = makeDeps();

    await makeAnswerClassQuestion(deps)({ blockId: 101 });

    const prompt = state.generateTextInputs[0].prompt;
    expect(prompt).not.toContain("Earlier questions the learner asked");
    expect(prompt).not.toContain("Background memory");
  });

  it("backfills the class content vectors and mines the answered block", async () => {
    const { deps, state } = makeDeps();

    await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(state.backfilledClassIds).toEqual([5]);
    expect(state.enqueued).toEqual([
      { jobName: QA_BLOCK_VECTORS_JOB, payload: { blockId: 101 } },
    ]);
    // The content vectorizer runs inline here — it never enqueues itself.
    expect(state.enqueued.some((job) => job.jobName === CLASS_CONTENT_VECTORS_JOB)).toBe(false);
  });

  it("persists the trimmed answer as ANSWERED with the model name", async () => {
    const { deps, state } = makeDeps({
      textResult: { raw: "  Left joins drop rows when the right side has no match.  " },
    });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({ ok: true, value: undefined });
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
  });

  it("marks the block FAILED on AI transport failure", async () => {
    const { deps, state } = makeDeps({
      textError: { kind: "AiGenerationFailed", detail: "upstream 500" },
    });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "AiGenerationFailed", detail: "upstream 500" },
    });
    expect(state.failed).toEqual([101]);
    expect(state.answered).toHaveLength(0);
    // A failed attempt mines nothing.
    expect(state.enqueued).toHaveLength(0);
  });

  it("marks the block FAILED on an empty completion", async () => {
    const { deps, state } = makeDeps({
      textResult: { raw: "   " },
    });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "AiResponseInvalid", detail: "empty completion" },
    });
    expect(state.failed).toEqual([101]);
  });

  it("marks the block FAILED when the class vanished", async () => {
    const { deps, state } = makeDeps({ klass: null });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "ClassNotFound", classId: 5 },
    });
    expect(state.failed).toEqual([101]);
  });

  it("marks the block FAILED when the skill vanished", async () => {
    const { deps, state } = makeDeps({ skill: null });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "ClassNotFound", classId: 5 },
    });
    expect(state.failed).toEqual([101]);
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
    expect(state.backfilledClassIds).toHaveLength(0);
  });

  it("no-ops when the block is gone", async () => {
    const { deps, state } = makeDeps({ block: null });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 404 });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(state.generateTextInputs).toHaveLength(0);
  });

  it("audits the answer call's token usage on QA_ANSWERED", async () => {
    const { deps, state } = makeDeps({
      textResult: {
        raw: "  Left joins drop rows when the right side has no match.  ",
        usage: { promptTokens: 40, completionTokens: 25 },
      },
    });

    const result = await makeAnswerClassQuestion(deps)({ blockId: 101 });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      skillId: 10,
      userId: 7,
      type: "QA_ANSWERED" satisfies EventType,
    });
    const payload = state.events[0].payload as { usage?: unknown; model?: string };
    expect(payload.usage).toEqual({ promptTokens: 40, completionTokens: 25 });
    expect(payload.model).toBe("glm-5.3-flash");
  });

  it("omits usage when the adapter reports none", async () => {
    const { deps, state } = makeDeps();

    await makeAnswerClassQuestion(deps)({ blockId: 101 });

    const payload = state.events[0].payload as { usage?: unknown };
    expect(payload.usage).toBeUndefined();
  });
});
