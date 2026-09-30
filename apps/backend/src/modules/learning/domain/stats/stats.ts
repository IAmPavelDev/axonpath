/**
 * Pure derivations behind `stats.overview`. Everything takes `now` (or a
 * window) explicitly — no hidden clock, so the calendar math is directly
 * testable. All day/week boundaries are UTC: ISO weeks start Monday 00:00,
 * streaks are consecutive UTC calendar days.
 */

/** One recorded attempt, shaped for stats derivations (see QuizRepository). */
export type AnswerActivity = {
  createdAt: Date;
  /** Owning skill, when the answer carries one. */
  skillId: number | null;
  /** Class the question belongs to — null for class-less questions. */
  classId: number | null;
  questionId: number;
};

/** Monday 00:00:00.000 UTC of the week containing `date`. */
export const weekStartUtc = (date: Date): Date => {
  // getUTCDay(): 0 = Sunday … 6 = Saturday → shift so Monday starts the week.
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - mondayOffset,
    ),
  );
};

export const WEEKS_IN_WINDOW = 8;

/** Eight week starts, oldest first, ending with the week containing `now`. */
export const statsWindow = (now: Date): Date[] => {
  const current = weekStartUtc(now).getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return Array.from(
    { length: WEEKS_IN_WINDOW },
    (_, i) => new Date(current - (WEEKS_IN_WINDOW - 1 - i) * weekMs),
  );
};

/**
 * Distinct skills with at least one answer per window week, zero-filled.
 * Class-less answers carry no skill and never inflate a week.
 */
export const weeklyActiveSkills = (
  rows: AnswerActivity[],
  window: Date[],
): Array<{ weekStart: Date; activeSkills: number }> => {
  const activeByWeek = new Map<number, Set<number>>();
  for (const row of rows) {
    if (row.skillId === null) continue;
    const weekStart = weekStartUtc(row.createdAt).getTime();
    if (!window.some((week) => week.getTime() === weekStart)) continue;
    const skills = activeByWeek.get(weekStart) ?? new Set<number>();
    skills.add(row.skillId);
    activeByWeek.set(weekStart, skills);
  }
  return window.map((weekStart) => ({
    weekStart,
    activeSkills: activeByWeek.get(weekStart.getTime())?.size ?? 0,
  }));
};

const dayKeyUtc = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
  (24 * 60 * 60 * 1000);

/**
 * Consecutive UTC calendar days with at least one answer, ending today or
 * yesterday — an answerless "today" keeps yesterday's streak alive until the
 * day ends.
 */
export const currentStreakDays = (
  rows: AnswerActivity[],
  now: Date,
): number => {
  if (rows.length === 0) return 0;
  const days = new Set(rows.map((row) => dayKeyUtc(row.createdAt)));
  const today = dayKeyUtc(now);
  let cursor = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
};

/** Answer rows in the week containing `now` — retakes included, by design. */
export const answersInCurrentWeek = (
  rows: AnswerActivity[],
  now: Date,
): number => {
  const currentWeek = weekStartUtc(now).getTime();
  return rows.filter(
    (row) => weekStartUtc(row.createdAt).getTime() === currentWeek,
  ).length;
};

/**
 * Classes fully covered by distinct questions answered in the current week:
 * a class counts once this week's distinct questions reach its question
 * count. Class-less answers never count; classes without questions never
 * complete (same rule as skill.progress).
 */
export const lessonsCompletedThisWeek = (
  rows: AnswerActivity[],
  now: Date,
  questionCountByClass: Map<number, number>,
): number => {
  const currentWeek = weekStartUtc(now).getTime();
  const questionsByClass = new Map<number, Set<number>>();
  for (const row of rows) {
    if (row.classId === null) continue;
    if (weekStartUtc(row.createdAt).getTime() !== currentWeek) continue;
    const questions = questionsByClass.get(row.classId) ?? new Set<number>();
    questions.add(row.questionId);
    questionsByClass.set(row.classId, questions);
  }
  let completed = 0;
  for (const [classId, questions] of questionsByClass) {
    const total = questionCountByClass.get(classId) ?? 0;
    if (total > 0 && questions.size >= total) completed += 1;
  }
  return completed;
};
