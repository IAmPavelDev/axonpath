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

/** One AI-kind bucket of the usage report. */
export const UsageKindSummary = z.object({
  events: z.number().int(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  estimatedCostUsd: z.number(),
});

export const UsageReportInput = z
  .object({
    skillId: z.number().int().positive().min(1).optional(),
  })
  .optional();

/** Token usage and estimated cost for the authenticated user (no admin surface). */
export const UsageReportOutput = z.object({
  totals: z.object({
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    embeddingTokens: z.number().int(),
    estimatedCostUsd: z.number(),
  }),
  byKind: z.object({
    skillInit: UsageKindSummary,
    nextClass: UsageKindSummary,
    qa: UsageKindSummary,
  }),
  /** Chat events whose payload lacks usage — counted, never costed. */
  eventsWithoutUsage: z.number().int(),
  /** Vectors without a tokenCount (capture degrade) — counted, never guessed. */
  vectorsWithoutTokenCount: z.number().int(),
  /** Oldest/newest chat event in scope; nulls when empty. */
  window: z.object({
    from: z.date().nullable(),
    to: z.date().nullable(),
  }),
});
