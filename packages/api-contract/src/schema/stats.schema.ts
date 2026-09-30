import z from 'zod';

export const WeeklyActiveSkillsPoint = z.object({
  /** Monday 00:00 UTC of the ISO week. */
  weekStart: z.date(),
  activeSkills: z.number().int(),
});

export const StatsSkillSummary = z.object({
  skillId: z.number(),
  topic: z.string(),
  lessonCount: z.number().int(),
  completedLessons: z.number().int(),
  lastActivityAt: z.date().nullable(),
});

/** Learning stats for the authenticated user — the retention signal. */
export const StatsOverviewOutput = z.object({
  /** Eight ISO weeks (Mon 00:00 UTC), oldest first, zero-filled. */
  weeklyActiveSkills: z.array(WeeklyActiveSkillsPoint),
  /** Consecutive UTC days with ≥1 answer, ending today or yesterday. */
  currentStreakDays: z.number().int(),
  /** Answer rows in the current week — retakes included. */
  answersThisWeek: z.number().int(),
  /** Classes fully covered by distinct questions answered this week. */
  lessonsCompletedThisWeek: z.number().int(),
  skills: z.array(StatsSkillSummary),
});
