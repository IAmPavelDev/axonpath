import { describe, expect, it } from "vitest";
import {
  makeGetLearningStats,
  type GetLearningStatsDeps,
} from "./get-learning-stats";
import type {
  SkillRepository,
  SkillListItem,
} from "@/modules/learning/domain/skill/skill.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";

/** 2026-09-30 is a Wednesday (ISO week Mon 2026-09-28 … Sun 2026-10-04). */
const at = (iso: string): Date => new Date(iso);

const skill = (overrides: Partial<SkillListItem> = {}): SkillListItem => ({
  id: 1,
  topic: "SQL joins",
  description: "",
  status: "ACTIVE",
  userId: 7,
  requestId: null,
  createdAt: at("2026-09-01T00:00:00Z"),
  updatedAt: at("2026-09-01T00:00:00Z"),
  lessonCount: 3,
  completedLessons: 1,
  learnedPoints: 4,
  lastActivityAt: at("2026-09-29T10:00:00Z"),
  ...overrides,
});

/** Test seam: capturing in-memory repos; `now` is fixed for determinism. */
const makeDeps = (
  options: {
    skills?: SkillListItem[];
    activity?: Array<{
      createdAt: Date;
      skillId: number | null;
      classId: number | null;
      questionId: number;
    }>;
    questionCounts?: Array<{ classId: number; questionCount: number }>;
  } = {},
) => {
  const state = {
    askedClassIds: [] as number[],
  };

  const skillRepo: SkillRepository = {
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    findById: async () => {
      throw new Error("not used");
    },
    listByUser: async () => options.skills ?? [],
    listByStatus: async () => {
      throw new Error("not used");
    },
    settleStaleGenerating: async () => [],
    claimStaleInit: async () => {
      throw new Error("not used");
    },
    claimStaleFirstLesson: async () => [],
    claimFirstLessonRun: async () => null,
    delete: async () => {},
  };
  const quizRepo: Pick<QuizRepository, "findAnswerActivityByUser"> = {
    findAnswerActivityByUser: async () => options.activity ?? [],
  };
  const classRepo: Pick<ClassRepository, "findQuestionCountsByClassIds"> = {
    findQuestionCountsByClassIds: async (classIds: number[]) => {
      state.askedClassIds = classIds;
      return options.questionCounts ?? [];
    },
  };

  const deps: GetLearningStatsDeps = {
    skillRepo,
    classRepo,
    quizRepo,
    // The suite pins "today" to 2026-09-30 (see the week comment above).
    clock: { now: () => at("2026-09-30T12:00:00Z") },
  };
  return { deps, state };
};

describe("makeGetLearningStats", () => {
  it("returns zero-filled weeks, no streak, and no skills for a fresh user", async () => {
    const { deps } = makeDeps();

    const stats = await makeGetLearningStats(deps)({ userId: 7 });

    expect(stats.weeklyActiveSkills).toHaveLength(8);
    expect(stats.weeklyActiveSkills.every((w) => w.activeSkills === 0)).toBe(
      true,
    );
    expect(stats.currentStreakDays).toBe(0);
    expect(stats.answersThisWeek).toBe(0);
    expect(stats.lessonsCompletedThisWeek).toBe(0);
    expect(stats.skills).toEqual([]);
  });

  it("derives the streak from answers today and yesterday", async () => {
    const { deps } = makeDeps({
      activity: [
        {
          createdAt: at("2026-09-29T09:00:00Z"),
          skillId: 1,
          classId: null,
          questionId: 1,
        },
        {
          createdAt: at("2026-09-30T09:00:00Z"),
          skillId: 1,
          classId: null,
          questionId: 2,
        },
      ],
    });

    const stats = await makeGetLearningStats(deps)({ userId: 7 });

    expect(stats.currentStreakDays).toBe(2);
  });

  it("counts distinct skills per week — retakes never inflate", async () => {
    const { deps } = makeDeps({
      activity: [
        {
          createdAt: at("2026-09-28T10:00:00Z"),
          skillId: 1,
          classId: null,
          questionId: 1,
        },
        {
          createdAt: at("2026-09-29T10:00:00Z"),
          skillId: 2,
          classId: null,
          questionId: 2,
        },
        {
          createdAt: at("2026-09-29T11:00:00Z"),
          skillId: 1,
          classId: null,
          questionId: 3,
        },
      ],
    });

    const stats = await makeGetLearningStats(deps)({ userId: 7 });

    expect(stats.weeklyActiveSkills[7]).toEqual({
      weekStart: at("2026-09-28T00:00:00Z"),
      activeSkills: 2,
    });
  });

  it("counts answer rows this week — retakes included", async () => {
    const { deps } = makeDeps({
      activity: [
        {
          createdAt: at("2026-09-28T10:00:00Z"),
          skillId: 1,
          classId: 11,
          questionId: 1,
        },
        {
          createdAt: at("2026-09-28T11:00:00Z"),
          skillId: 1,
          classId: 11,
          questionId: 1,
        },
        {
          createdAt: at("2026-09-20T10:00:00Z"),
          skillId: 1,
          classId: 11,
          questionId: 1,
        },
      ],
    });

    const stats = await makeGetLearningStats(deps)({ userId: 7 });

    expect(stats.answersThisWeek).toBe(2);
  });

  it("completes a lesson only when this week's questions cover the class", async () => {
    const { deps, state } = makeDeps({
      activity: [
        // Class 11 (2 questions) fully covered this week.
        {
          createdAt: at("2026-09-28T10:00:00Z"),
          skillId: 1,
          classId: 11,
          questionId: 1,
        },
        {
          createdAt: at("2026-09-28T12:00:00Z"),
          skillId: 1,
          classId: 11,
          questionId: 2,
        },
        // Class 12 (3 questions) only partially covered.
        {
          createdAt: at("2026-09-29T10:00:00Z"),
          skillId: 1,
          classId: 12,
          questionId: 5,
        },
      ],
      questionCounts: [
        { classId: 11, questionCount: 2 },
        { classId: 12, questionCount: 3 },
      ],
    });

    const stats = await makeGetLearningStats(deps)({ userId: 7 });

    expect(stats.lessonsCompletedThisWeek).toBe(1);
    // Counts are only fetched for the classes touched this week.
    expect(state.askedClassIds.sort()).toEqual([11, 12]);
  });

  it("maps the per-skill block from the skill list", async () => {
    const { deps } = makeDeps({
      skills: [skill()],
    });

    const stats = await makeGetLearningStats(deps)({ userId: 7 });

    expect(stats.skills).toEqual([
      {
        skillId: 1,
        topic: "SQL joins",
        lessonCount: 3,
        completedLessons: 1,
        lastActivityAt: at("2026-09-29T10:00:00Z"),
      },
    ]);
  });

  it("skips the question-count lookup when nothing was answered this week", async () => {
    const { deps, state } = makeDeps({
      activity: [
        {
          createdAt: at("2026-09-10T10:00:00Z"),
          skillId: 1,
          classId: 11,
          questionId: 1,
        },
      ],
    });

    await makeGetLearningStats(deps)({ userId: 7 });

    expect(state.askedClassIds).toEqual([]);
  });
});
