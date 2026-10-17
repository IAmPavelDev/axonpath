import { describe, expect, it } from "vitest";
import {
  makeRetryClassQuestion,
  type RetryClassQuestionDeps,
} from "./retry-class-question";
import { CLASS_QA_ANSWER_JOB } from "@/modules/tutoring/application/answer-class-question";
import { err, ok } from "@/modules/platform/result";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassQaEntity } from "@/modules/learning/domain/class-qa/class-qa";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  ClassQaStatus,
} from "@/prisma/generated";

const CLASS = {
  id: 5,
  skillId: 10,
  index: 0,
  title: "Joins",
  contentMd: "## Intro",
};
const SKILL = {
  id: 10,
  userId: 7,
  topic: "SQL",
  prompt: "",
  description: "",
  status: "ACTIVE",
};

const failedBlock = (
  overrides: Partial<ClassQaEntity> = {},
): ClassQaEntity => ({
  id: 101,
  classId: CLASS.id,
  userId: SKILL.userId,
  anchorParagraph: 0,
  anchorText: null,
  question: "Why does LEFT JOIN keep unmatched rows?",
  answer: null,
  status: ClassQaStatus.FAILED,
  aiModel: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...overrides,
});

type RetryState = {
  resetIds: number[];
  enqueued: { jobName: string; payload: unknown }[];
};

/** Test seam: in-memory deps capturing every interaction. */
const makeDeps = (
  overrides: {
    klass?: typeof CLASS | null;
    skill?: typeof SKILL | null;
    block?: ClassQaEntity | null;
    resetFails?: boolean;
  } = {},
) => {
  const state: RetryState = { resetIds: [], enqueued: [] };

  const classRepo: ClassRepository = {
    findQuestionCountsByClassIds: async () => {
      throw new Error("not used in retry tests");
    },
    createWithQuestions: async () => {
      throw new Error("not used in retry tests");
    },
    listBySkill: async () => {
      throw new Error("not used in retry tests");
    },
    listBySkillByIndex: async () => {
      throw new Error("not used in retry tests");
    },
    listByIds: async () => {
      throw new Error("not used in retry tests");
    },
    findTopBySkill: async () => {
      throw new Error("not used in retry tests");
    },
    findById: async () =>
      overrides.klass === undefined ? CLASS : overrides.klass,
  };

  const skillRepo: SkillRepository = {
    create: async () => {
      throw new Error("not used in retry tests");
    },
    update: async () => {
      throw new Error("not used in retry tests");
    },
    findById: async () =>
      overrides.skill === undefined ? SKILL : overrides.skill,
    listByUser: async () => {
      throw new Error("not used in retry tests");
    },
    listByStatus: async () => {
      throw new Error("not used in retry tests");
    },
    settleStaleGenerating: async () => [],
    claimStaleInit: async () => {
      throw new Error("not used in retry tests");
    },
    claimStaleFirstLesson: async () => [],
  };

  const qaRepo: ClassQaRepository = {
    create: async () => {
      throw new Error("not used in retry tests");
    },
    listByClass: async () => {
      throw new Error("not used in retry tests");
    },
    listAnsweredByClass: async () => {
      throw new Error("not used in retry tests");
    },
    findById: async () =>
      overrides.block === undefined ? failedBlock() : overrides.block,
    answer: async () => {
      throw new Error("not used in retry tests");
    },
    markFailed: async () => {
      throw new Error("not used in retry tests");
    },
    resetForRetry: async (id) => {
      if (overrides.resetFails) return null;
      state.resetIds.push(id);
      return { id, status: ClassQaStatus.PENDING };
    },
    claimStranded: async () => {
      throw new Error("not used in retry tests");
    },
    failExhausted: async () => {
      throw new Error("not used in retry tests");
    },
  };

  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      state.enqueued.push({ jobName, payload });
    },
  };

  const deps: RetryClassQuestionDeps = { classRepo, skillRepo, qaRepo, jobs };
  return { deps, state };
};

const input = { classId: CLASS.id, userId: SKILL.userId, blockId: 101 };

describe("retryClassQuestion", () => {
  it("restarts a FAILED block in place and re-fires the answer job", async () => {
    const { deps, state } = makeDeps();

    const result = await makeRetryClassQuestion(deps)(input);

    expect(result).toEqual(ok({ blockId: 101, status: "PENDING" as const }));
    expect(state.resetIds).toEqual([101]);
    expect(state.enqueued).toEqual([
      { jobName: CLASS_QA_ANSWER_JOB, payload: { blockId: 101 } },
    ]);
  });

  it("refuses a block that is not FAILED (PENDING or ANSWERED)", async () => {
    for (const status of [ClassQaStatus.PENDING, ClassQaStatus.ANSWERED]) {
      const { deps, state } = makeDeps({ block: failedBlock({ status }) });

      const result = await makeRetryClassQuestion(deps)(input);

      expect(result).toEqual(
        err({ kind: "QaRetryNotAllowed", blockId: 101, status }),
      );
      expect(state.enqueued).toEqual([]);
    }
  });

  it("maps a lost reset race to QaRetryNotAllowed without enqueueing", async () => {
    const { deps, state } = makeDeps({ resetFails: true });

    const result = await makeRetryClassQuestion(deps)(input);

    expect(result).toEqual(
      err({
        kind: "QaRetryNotAllowed",
        blockId: 101,
        status: ClassQaStatus.FAILED,
      }),
    );
    expect(state.enqueued).toEqual([]);
  });

  it("hides a block from another class or learner behind BlockNotFound", async () => {
    const foreign = failedBlock({ classId: 999 });
    expect(
      (await makeRetryClassQuestion(makeDeps({ block: foreign }).deps)(input))
        .ok,
    ).toBe(false);
    expect(
      (
        await makeRetryClassQuestion(
          makeDeps({ block: failedBlock({ userId: 42 }) }).deps,
        )(input)
      ).ok,
    ).toBe(false);
  });

  it("maps ownership failures like ask does", async () => {
    expect(
      (await makeRetryClassQuestion(makeDeps({ klass: null }).deps)(input)).ok,
    ).toBe(false);
    expect(
      (await makeRetryClassQuestion(makeDeps({ skill: null }).deps)(input)).ok,
    ).toBe(false);
    const notOwned = await makeRetryClassQuestion(
      makeDeps({ skill: { ...SKILL, userId: 42 } }).deps,
    )(input);
    expect(notOwned).toEqual(err({ kind: "NotOwned", skillId: SKILL.id }));
  });
});
