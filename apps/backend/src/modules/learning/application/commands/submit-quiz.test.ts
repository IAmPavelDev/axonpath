import { describe, expect, it } from "vitest";
import { makeSubmitQuiz } from "./submit-quiz";
import { SKILL_NEXT_CLASS_JOB } from "@/modules/tutoring/application/generate-next-class";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ScoreableQuestion } from "@/modules/learning/domain/quiz/question";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { EventRepository, DomainEvent } from "@/modules/learning/domain/event/event.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import type { NextClassJobRepository } from "@/modules/jobs/next-class-job.repository";
import { ok } from "@/modules/platform/result";

const QUESTIONS: ScoreableQuestion[] = [
  { id: 1, skillId: 10, type: "MULTIPLE_CHOICE", answerKey: "Paris" },
  { id: 2, skillId: 10, type: "TRUE_FALSE", answerKey: "True" },
  { id: 3, skillId: 10, type: "OPEN_ENDED", answerKey: { rubric: "any" } },
];

/** Test seam: in-memory repos capturing persisted rows, events, and enqueued jobs. */
const makeFakeRepos = (questions: ScoreableQuestion[], skillStatus = "ACTIVE") => {
  const answerRows: unknown[] = [];
  const events: DomainEvent[] = [];
  const enqueued: { jobName: string; payload: unknown }[] = [];
  const nextClassEnqueued: { skillId: number; userId: number }[] = [];
  const skillUpdates: { id: number; patch: Record<string, unknown> }[] = [];
  let status = skillStatus;

  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      enqueued.push({ jobName, payload });
    },
  };

  // Durable marker fake: upsert semantics, one row per skill.
  const nextClassJobs: NextClassJobRepository = {
    enqueue: async ({ skillId, userId }) => {
      nextClassEnqueued.push({ skillId, userId });
    },
    claim: async () => {
      throw new Error("not used in submit tests");
    },
    claimOne: async () => null,
    release: async () => {},
    existsPending: async () => false,
    requeue: async () => {},
  };
  const quizRepo: QuizRepository = {
    findByClassId: async () => {
      throw new Error("not used in submit tests");
    },
    findScoreableByClassId: async () => questions,
    createAnswers: async (inputs) => {
      answerRows.push(...inputs);
    },
    findAnswersByClassAndUser: async () => {
      throw new Error("not used in submit tests");
    },
    findHighestAnsweredClassIndex: async () => {
      throw new Error("not used in submit tests");
    },
    findAnswerStatsBySkill: async () => {
      throw new Error("not used in submit tests");
    },
  };

  const skillRepo: SkillRepository = {
    create: async () => {
      throw new Error("not used in submit tests");
    },
    update: async (id, patch) => {
      skillUpdates.push({ id, patch });
      if (typeof patch.status === "string") status = patch.status;
      return { id, topic: "SQL joins", description: "", status };
    },
    findById: async () => ({
      id: 10,
      topic: "SQL joins",
      description: "",
      status,
      userId: 1,
    }),
    listByUser: async () => [],
    listByStatus: async () => [],
  };

  const eventRepo: EventRepository = {
    record: async (event) => {
      events.push(event);
    },
  };

  return {
    submitQuiz: makeSubmitQuiz({ quizRepo, eventRepo, skillRepo, jobs, nextClassJobs }),
    answerRows,
    events,
    enqueued,
    nextClassEnqueued,
    skillUpdates,
  };
};

describe("makeSubmitQuiz", () => {
  it("scores an MC/TF mix and returns per-question results", async () => {
    const { submitQuiz } = makeFakeRepos(QUESTIONS);

    const result = await submitQuiz({
      classId: 100,
      userId: 1,
      answers: [
        { questionId: 1, answer: "Paris" },
        { questionId: 2, answer: "False" },
      ],
    });

    expect(result).toEqual(
      ok({
        score: 1,
        total: 2,
        perQuestion: [
          { questionId: 1, isCorrect: true, correctAnswer: "Paris" },
          { questionId: 2, isCorrect: false, correctAnswer: "True" },
        ],
      }),
    );
  });

  it("skips submitted ids that are not questions of the class", async () => {
    const { submitQuiz, answerRows } = makeFakeRepos(QUESTIONS);

    const result = await submitQuiz({
      classId: 100,
      userId: 1,
      answers: [
        { questionId: 1, answer: "Paris" },
        { questionId: 999, answer: "stale" },
      ],
    });

    expect(result.ok && result.value.total).toBe(1);
    expect(answerRows).toHaveLength(1);
    expect(result.ok && result.value.perQuestion.map((q) => q.questionId)).toEqual([1]);
  });

  it("fails ClassNotFound for a class with no questions and persists nothing", async () => {
    const { submitQuiz, answerRows, events } = makeFakeRepos([]);

    const result = await submitQuiz({
      classId: 404,
      userId: 1,
      answers: [{ questionId: 1, answer: "Paris" }],
    });

    expect(result).toEqual({ ok: false, error: { kind: "ClassNotFound", classId: 404 } });
    expect(answerRows).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("persists Answer rows with the { answer } content convention and default timeSpentMs", async () => {
    const { submitQuiz, answerRows } = makeFakeRepos(QUESTIONS);

    await submitQuiz({
      classId: 100,
      userId: 7,
      answers: [
        { questionId: 1, answer: "Paris", timeSpentMs: 4200 },
        { questionId: 2, answer: "True" },
      ],
    });

    expect(answerRows).toEqual([
      {
        questionId: 1,
        userId: 7,
        skillId: 10,
        content: { answer: "Paris" },
        score: 1,
        isCorrect: true,
        timeSpentMs: 4200,
      },
      {
        questionId: 2,
        userId: 7,
        skillId: 10,
        content: { answer: "True" },
        score: 1,
        isCorrect: true,
        timeSpentMs: 0,
      },
    ]);
  });

  it("open-ended questions are persisted with score 0 and a null correctAnswer", async () => {
    const { submitQuiz, answerRows } = makeFakeRepos(QUESTIONS);

    const result = await submitQuiz({
      classId: 100,
      userId: 1,
      answers: [{ questionId: 3, answer: "my essay" }],
    });

    expect(result.ok && result.value.perQuestion[0]).toEqual({
      questionId: 3,
      isCorrect: false,
      correctAnswer: null,
    });
    expect(answerRows[0]).toMatchObject({ score: 0, isCorrect: false });
  });

  it("records an ANSWER_SUBMITTED event with class score/total and the class skillId", async () => {
    const { submitQuiz, events } = makeFakeRepos(QUESTIONS);

    await submitQuiz({
      classId: 100,
      userId: 1,
      answers: [
        { questionId: 1, answer: "Paris" },
        { questionId: 2, answer: "True" },
      ],
    });

    expect(events).toEqual([
      {
        skillId: 10,
        userId: 1,
        type: "ANSWER_SUBMITTED",
        payload: { classId: 100, score: 2, total: 2 },
      },
    ]);
  });

  it("enqueues skill-next-class once with the class skillId after a scored submit", async () => {
    const { submitQuiz, enqueued, nextClassEnqueued } = makeFakeRepos(QUESTIONS);

    await submitQuiz({
      classId: 100,
      userId: 1,
      answers: [
        { questionId: 1, answer: "Paris" },
        { questionId: 2, answer: "True" },
      ],
    });

    expect(enqueued).toEqual([
      { jobName: SKILL_NEXT_CLASS_JOB, payload: { skillId: 10, userId: 1 } },
    ]);
    // The durable marker is what survives a restart; the in-memory job only
    // makes pickup instant.
    expect(nextClassEnqueued).toEqual([{ skillId: 10, userId: 1 }]);
  });

  it("does not enqueue next-class generation when nothing valid was scored", async () => {
    const { submitQuiz, enqueued, nextClassEnqueued, skillUpdates } = makeFakeRepos(QUESTIONS);

    await submitQuiz({ classId: 100, userId: 1, answers: [] });

    expect(enqueued).toEqual([]);
    expect(nextClassEnqueued).toEqual([]);
    expect(skillUpdates).toEqual([]);
  });

  it("flips the skill to GENERATING after a scored submit", async () => {
    // The user-visible phase change: the submit marks the skill as composing
    // its next lesson before anything is enqueued.
    const { submitQuiz, skillUpdates } = makeFakeRepos(QUESTIONS);

    await submitQuiz({
      classId: 100,
      userId: 1,
      answers: [{ questionId: 1, answer: "Paris" }],
    });

    expect(skillUpdates).toEqual([{ id: 10, patch: { status: "GENERATING" } }]);
  });

  it("leaves a non-ACTIVE skill's status alone but still enqueues generation", async () => {
    // PAUSED/COMPLETED/ARCHIVED skills have user-owned statuses; the flip is
    // illegal there even though the learning signal still enqueues a job.
    const { submitQuiz, skillUpdates, nextClassEnqueued } = makeFakeRepos(QUESTIONS, "PAUSED");

    await submitQuiz({
      classId: 100,
      userId: 1,
      answers: [{ questionId: 1, answer: "Paris" }],
    });

    expect(skillUpdates).toEqual([]);
    expect(nextClassEnqueued).toEqual([{ skillId: 10, userId: 1 }]);
  });
});
