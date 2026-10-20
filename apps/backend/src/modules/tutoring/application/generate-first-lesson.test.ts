import { describe, expect, it } from "vitest";
import {
  makeGenerateFirstLesson,
  type GenerateFirstLessonDeps,
} from "./generate-first-lesson";
import { EventType, SkillStatus, VectorSource } from "@/prisma/generated";
import type { AiError } from "@/modules/tutoring/ports";
import type { DomainEvent } from "@/modules/learning/domain/event/event.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { NewVector } from "@/modules/memory/ports";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { err, ok } from "@/modules/platform/result";

const LESSON_JSON = JSON.stringify({
  classTitle: "SQL joins from zero",
  classContentMd: "## Introduction\nMeet the join.",
  baseLanguage: "en",
  contentLanguages: ["en"],
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

type Overrides = {
  raw?: string;
  error?: AiError;
  usage?: { promptTokens: number; completionTokens: number };
  failParse?: boolean;
  failEmbeddings?: boolean;
  failVectorRecord?: boolean;
  existingClass?: { id: number; index: number; title: string } | null;
  skill?: Partial<{ topic: string; prompt: string; description: string }>;
};

/** Test seam: scripted AiPort + in-memory repos capturing the full persist
 * path (class, questions, vectors, audit, status). */
const makeDeps = (overrides: Overrides = {}) => {
  const state = {
    skillUpdates: [] as { id: number; patch: Record<string, unknown> }[],
    createdClasses: [] as unknown[],
    createdQuestions: [] as unknown[],
    vectors: [] as NewVector[],
    events: [] as DomainEvent[],
    enqueued: [] as { jobName: string; payload: unknown }[],
    aiCalls: [] as { schemaName: string; prompt: string }[],
    retrievedQueries: [] as string[],
  };

  const deps: GenerateFirstLessonDeps = {
    recordAiAttempt: () => {},
    ai: {
      generateJson: async (input, request) => {
        state.aiCalls.push({ schemaName: request.schemaName, prompt: input.prompt });
        if (overrides.error) {
          return { ok: false, error: overrides.error };
        }
        const raw =
          overrides.failParse === true
            ? "prose answer, not JSON at all"
            : (overrides.raw ?? LESSON_JSON);
        return ok({ raw, usage: overrides.usage });
      },
      generateText: async () => {
        throw new Error("generateText not used in first-lesson tests");
      },
      generateEmbeddings: async (content) => {
        if (overrides.failEmbeddings) {
          const error: AiError = { kind: "AiGenerationFailed", detail: "embeddings down" };
          return { ok: false, error };
        }
        return ok({
          embeddings: content.map(() => [0.1, 0.2, 0.3]),
          usage: { tokens: 100 },
        });
      },
    },
    retrieveContext: async (input) => {
      state.retrievedQueries.push(input.query);
      return [{ textSnippet: "Prior skill memory" }];
    },
    skillRepo: {
      create: async () => {
        throw new Error("create not used in first-lesson tests");
      },
      update: async (id, patch) => {
        state.skillUpdates.push({ id, patch: { ...patch } });
        return { id, topic: "SQL Joins", description: "d", status: "ACTIVE" };
      },
      findById: async () => ({
        id: 10,
        userId: 1,
        topic: "SQL Joins",
        prompt: "I want to learn SQL joins for work.",
        description: "Learn SQL joins by doing.",
        status: SkillStatus.GENERATING,
        ...overrides.skill,
      }),
      listByUser: async () => [],
      listByStatus: async () => [],
      settleStaleGenerating: async () => [],
      claimStaleInit: async () => [],
      claimStaleFirstLesson: async () => [],
      delete: async () => {},
    } satisfies SkillRepository,
    classRepo: {
      findQuestionCountsByClassIds: async () => [],
      createWithQuestions: async (cls, questions) => {
        state.createdClasses.push(cls);
        state.createdQuestions.push(...questions);
        return { id: 77 };
      },
      listBySkill: async () => [],
      listBySkillByIndex: async () => [],
      listByIds: async () => [],
      findTopBySkill: async () =>
        overrides.existingClass === undefined ? null : overrides.existingClass,
      findById: async () => null,
    } satisfies ClassRepository,
    quizRepo: {
      findLatestAttemptResults: async () => [],
      listPendingGradingIds: async () => [],
      findWrongAnswersBySkill: async () => [],
      findAnswerActivityByUser: async () => [],
      findByClassId: async () => [],
      findScoreableByClassId: async () => [],
      createAnswers: async () => [],
      findAnswersByClassAndUser: async () => [],
      findAnswerStatsBySkill: async () => [],
      findAnswersWithQuestions: async () => [],
      updateGrades: async () => undefined,
      findHighestAnsweredClassIndex: async () => null,
      findReviewCandidatesBySkill: async () => [],
    } satisfies QuizRepository,
    eventRepo: {
      findUsageEvents: async () => [],
      record: async (event) => {
        state.events.push(event);
      },
    },
    recordVectors: async (vectors) => {
      if (overrides.failVectorRecord) {
        return err({ kind: "VectorUpsertFailed", detail: "store down" });
      }
      state.vectors.push(...vectors);
      return ok(vectors.map((_, i) => 900 + i));
    },
    chatModel: "glm-5.3-flash",
    jobs: {
      enqueue: (jobName, payload) => {
        state.enqueued.push({ jobName, payload });
      },
    } satisfies JobQueuePort,
  };

  return { deps, state };
};

const INPUT = { skillId: 10, userId: 1 };

describe("makeGenerateFirstLesson", () => {
  it("persists class 0 with questions, memory vectors and settles ACTIVE", async () => {
    const { deps, state } = makeDeps({
      usage: { promptTokens: 500, completionTokens: 900 },
    });

    const result = await makeGenerateFirstLesson(deps)(INPUT);

    expect(result.ok).toBe(true);
    // Status lifecycle: ACTIVE on success (the acceptance edit set GENERATING).
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.ACTIVE });
    expect(state.createdClasses).toEqual([
      {
        skillId: 10,
        index: 0,
        title: "SQL joins from zero",
        contentMd: "## Introduction\nMeet the join.",
        baseLanguage: "en",
        aiModel: "glm-5.3-flash",
      },
    ]);
    expect(state.createdQuestions).toHaveLength(1);
    // Lesson summary is the AI_NEXT memory unit; snippets are AI_INITIAL.
    expect(state.vectors.map((vector) => vector.source)).toEqual([
      VectorSource.AI_NEXT,
      VectorSource.AI_INITIAL,
    ]);
    expect(state.vectors[0]).toMatchObject({
      skillId: 10,
      userId: 1,
      classId: 77,
      classIndex: 0,
    });
    // Conspect memory rides the fire-and-forget queue with the fresh class id.
    expect(state.enqueued).toEqual([
      { jobName: "class-content-vectors", payload: { classId: 77 } },
    ]);
  });

  it("briefs the model with the stored prompt and the accepted description", async () => {
    const { deps, state } = makeDeps();

    await makeGenerateFirstLesson(deps)(INPUT);

    const prompt = state.aiCalls[0]?.prompt ?? "";
    expect(state.aiCalls[0]?.schemaName).toBe("init_skill");
    // The learner's original brief, not just the generated title...
    expect(prompt).toContain('"""I want to learn SQL joins for work."""');
    // ...and the possibly user-edited draft description.
    expect(prompt).toContain('"""Learn SQL joins by doing."""');
    // Prior-skill memory is labelled as Axon's observations.
    expect(prompt).toContain("Notes Axon wrote about this learner");
    expect(state.retrievedQueries).toEqual(["I want to learn SQL joins for work."]);
  });

  it("falls back to the topic when the stored prompt is empty (pre-migration skills)", async () => {
    const { deps, state } = makeDeps({ skill: { prompt: "" } });

    await makeGenerateFirstLesson(deps)(INPUT);

    expect(state.retrievedQueries).toEqual(["SQL Joins"]);
  });

  it("audits CLASS_GENERATED with the first_lesson action and usage", async () => {
    const { deps, state } = makeDeps({
      usage: { promptTokens: 500, completionTokens: 900 },
    });

    await makeGenerateFirstLesson(deps)(INPUT);

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      skillId: 10,
      userId: 1,
      type: EventType.CLASS_GENERATED,
    });
    const payload = state.events[0]?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      action: "first_lesson",
      model: "glm-5.3-flash",
      usage: { promptTokens: 500, completionTokens: 900 },
    });
  });

  it("replays safely: an existing class short-circuits generation and only heals the status", async () => {
    const { deps, state } = makeDeps({
      existingClass: { id: 77, index: 0, title: "SQL joins from zero" },
    });

    const result = await makeGenerateFirstLesson(deps)(INPUT);

    expect(result.ok).toBe(true);
    expect(state.aiCalls).toHaveLength(0);
    expect(state.createdClasses).toHaveLength(0);
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.ACTIVE });
  });

  it("fails AiResponseInvalid and persists nothing when the model output is unparseable", async () => {
    const { deps, state } = makeDeps({ failParse: true });

    const result = await makeGenerateFirstLesson(deps)(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AiResponseInvalid");
    expect(state.createdClasses).toHaveLength(0);
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.FAILED });
    expect(state.events[0]).toMatchObject({ type: EventType.ERROR_OCCURRED });
  });

  it("fails AiResponseInvalid when the model returns no questions", async () => {
    const { deps, state } = makeDeps({
      raw: JSON.stringify({
        classTitle: "t",
        classContentMd: "c",
        baseLanguage: "en",
        contentLanguages: ["en"],
        lessonSummary: "s",
        questions: [],
        contextSnippets: [],
      }),
    });

    const result = await makeGenerateFirstLesson(deps)(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toContain("no questions");
    expect(state.createdClasses).toHaveLength(0);
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.FAILED });
  });

  it("propagates AiGenerationFailed from the AI adapter and settles FAILED", async () => {
    const { deps, state } = makeDeps({
      error: { kind: "AiGenerationFailed", detail: "transport down" },
    });

    const result = await makeGenerateFirstLesson(deps)(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "AiGenerationFailed", detail: "transport down" },
    });
    expect(state.createdClasses).toHaveLength(0);
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.FAILED });
  });

  it("keeps the persisted class when embeddings fail after the persist (retry heals)", async () => {
    const { deps, state } = makeDeps({ failEmbeddings: true });

    const result = await makeGenerateFirstLesson(deps)(INPUT);

    expect(result.ok).toBe(false);
    expect(state.createdClasses).toHaveLength(1);
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.FAILED });
    expect(state.vectors).toHaveLength(0);
  });

  it("treats vector recording as best-effort: a store outage still settles ACTIVE", async () => {
    const { deps, state } = makeDeps({ failVectorRecord: true });

    const result = await makeGenerateFirstLesson(deps)(INPUT);

    expect(result.ok).toBe(true);
    expect(state.createdClasses).toHaveLength(1);
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.ACTIVE });
  });
});
