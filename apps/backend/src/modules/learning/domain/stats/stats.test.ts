import { describe, expect, it } from "vitest";
import {
  answersInCurrentWeek,
  currentStreakDays,
  lessonsCompletedThisWeek,
  statsWindow,
  weekStartUtc,
  weeklyActiveSkills,
  type AnswerActivity,
} from "./stats";

const utc = (iso: string): Date => new Date(iso);
const activity = (
  createdAt: string,
  overrides: Partial<AnswerActivity> = {},
): AnswerActivity => ({
  createdAt: utc(createdAt),
  skillId: 1,
  classId: null,
  questionId: 1,
  ...overrides,
});

// 2026-09-30 is a Wednesday; its ISO week starts Mon 2026-09-28T00:00Z.
const NOW = utc("2026-09-30T15:00:00Z");

describe("weekStartUtc", () => {
  it("snaps to Monday 00:00 UTC across the week", () => {
    expect(weekStartUtc(utc("2026-09-28T05:13:00Z"))).toEqual(
      utc("2026-09-28T00:00:00Z"),
    );
    expect(weekStartUtc(NOW)).toEqual(utc("2026-09-28T00:00:00Z"));
  });

  it("maps Sunday to the Monday that started its week", () => {
    // 2026-10-04 is a Sunday.
    expect(weekStartUtc(utc("2026-10-04T23:59:00Z"))).toEqual(
      utc("2026-09-28T00:00:00Z"),
    );
  });
});

describe("statsWindow", () => {
  it("returns eight zero-filled week starts, oldest first, ending this week", () => {
    const window = statsWindow(NOW);
    expect(window).toHaveLength(8);
    expect(window[0]).toEqual(utc("2026-08-10T00:00:00Z"));
    expect(window[7]).toEqual(utc("2026-09-28T00:00:00Z"));
    for (const week of window) {
      expect(week.getUTCDay()).toBe(1);
      expect(week.getUTCHours()).toBe(0);
    }
  });
});

describe("weeklyActiveSkills", () => {
  it("counts distinct skills per week and zero-fills empty weeks", () => {
    const rows = [
      activity("2026-09-28T10:00:00Z", { skillId: 1 }),
      activity("2026-09-29T10:00:00Z", { skillId: 2 }),
      // Retakes of the same skill never double-count a week.
      activity("2026-09-29T11:00:00Z", { skillId: 1 }),
      // The prior window week had exactly one active skill.
      activity("2026-09-21T10:00:00Z", { skillId: 3 }),
    ];
    const weekly = weeklyActiveSkills(rows, statsWindow(NOW));
    expect(weekly).toHaveLength(8);
    expect(weekly[7]).toEqual({
      weekStart: utc("2026-09-28T00:00:00Z"),
      activeSkills: 2,
    });
    expect(weekly[6]).toEqual({
      weekStart: utc("2026-09-21T00:00:00Z"),
      activeSkills: 1,
    });
    expect(weekly[0].activeSkills).toBe(0);
  });

  it("ignores class-less answers for weekly actives (no skill attached)", () => {
    const rows = [activity("2026-09-28T10:00:00Z", { skillId: null })];
    expect(weeklyActiveSkills(rows, statsWindow(NOW))[7].activeSkills).toBe(0);
  });
});

describe("currentStreakDays", () => {
  it("is zero for an empty history", () => {
    expect(currentStreakDays([], NOW)).toBe(0);
  });

  it("counts an answer today only as a one-day streak", () => {
    const rows = [activity("2026-09-30T09:00:00Z")];
    expect(currentStreakDays(rows, NOW)).toBe(1);
  });

  it("keeps yesterday alive when today has no answer yet", () => {
    const rows = [activity("2026-09-29T09:00:00Z")];
    expect(currentStreakDays(rows, NOW)).toBe(1);
  });

  it("breaks when the last answer is the day before yesterday", () => {
    const rows = [activity("2026-09-28T09:00:00Z")];
    expect(currentStreakDays(rows, NOW)).toBe(0);
  });

  it("walks a three-day chain back from today", () => {
    const rows = [
      activity("2026-09-28T09:00:00Z"),
      activity("2026-09-29T09:00:00Z"),
      activity("2026-09-30T09:00:00Z"),
    ];
    expect(currentStreakDays(rows, NOW)).toBe(3);
  });

  it("stops at the first gap in the chain", () => {
    const rows = [
      activity("2026-09-25T09:00:00Z"),
      activity("2026-09-26T09:00:00Z"),
      // 2026-09-27 missed.
      activity("2026-09-29T09:00:00Z"),
      activity("2026-09-30T09:00:00Z"),
    ];
    expect(currentStreakDays(rows, NOW)).toBe(2);
  });
});

describe("answersInCurrentWeek", () => {
  it("counts every answer row this week — retakes included — and none before", () => {
    const rows = [
      activity("2026-09-28T10:00:00Z"),
      activity("2026-09-28T11:00:00Z"),
      activity("2026-09-27T10:00:00Z"), // last week's Sunday
    ];
    expect(answersInCurrentWeek(rows, NOW)).toBe(2);
  });
});

describe("lessonsCompletedThisWeek", () => {
  const counts = new Map([
    [11, 2],
    [12, 3],
  ]);

  it("counts a class once this week's distinct questions cover it", () => {
    const rows = [
      activity("2026-09-28T10:00:00Z", { classId: 11, questionId: 1 }),
      // Retake of question 1 must not inflate; question 2 completes the class.
      activity("2026-09-28T11:00:00Z", { classId: 11, questionId: 1 }),
      activity("2026-09-29T10:00:00Z", { classId: 11, questionId: 2 }),
    ];
    expect(lessonsCompletedThisWeek(rows, NOW, counts)).toBe(1);
  });

  it("withholds a partially covered class and ignores other weeks", () => {
    const rows = [
      activity("2026-09-28T10:00:00Z", { classId: 12, questionId: 5 }),
      // Last week's answers do not help this week's coverage.
      activity("2026-09-24T10:00:00Z", { classId: 12, questionId: 6 }),
      activity("2026-09-24T11:00:00Z", { classId: 12, questionId: 7 }),
    ];
    expect(lessonsCompletedThisWeek(rows, NOW, counts)).toBe(0);
  });

  it("never completes a class without questions or class-less answers", () => {
    const rows = [
      activity("2026-09-28T10:00:00Z", { classId: 99, questionId: 1 }),
      activity("2026-09-28T11:00:00Z", { classId: null, questionId: 2 }),
    ];
    expect(lessonsCompletedThisWeek(rows, NOW, counts)).toBe(0);
  });
});
