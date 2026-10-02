import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { Clock } from "@/modules/platform/ports/clock";
import {
  answersInCurrentWeek,
  currentStreakDays,
  lessonsCompletedThisWeek,
  statsWindow,
  weekStartUtc,
  weeklyActiveSkills,
} from "@/modules/learning/domain/stats/stats";

export type GetLearningStatsDeps = {
  skillRepo: SkillRepository;
  classRepo: Pick<ClassRepository, "findQuestionCountsByClassIds">;
  quizRepo: Pick<QuizRepository, "findAnswerActivityByUser">;
  clock: Clock;
};

export type GetLearningStatsInput = {
  userId: number;
};

export type StatsSkillSummary = {
  skillId: number;
  topic: string;
  lessonCount: number;
  completedLessons: number;
  lastActivityAt: Date | null;
};

export type StatsOverview = {
  /** Eight ISO weeks (Mon 00:00 UTC), oldest first, zero-filled. */
  weeklyActiveSkills: Array<{ weekStart: Date; activeSkills: number }>;
  /** Consecutive UTC days with ≥1 answer, ending today or yesterday. */
  currentStreakDays: number;
  /** Answer rows in the current week — retakes included. */
  answersThisWeek: number;
  /** Classes fully covered by distinct questions answered this week. */
  lessonsCompletedThisWeek: number;
  /** Per-skill totals (archived excluded, same default as skill.list). */
  skills: StatsSkillSummary[];
};

/**
 * Learning stats for the stats.overview route — the retention signal of
 * BUSINESS_DECISIONS §4.3. Derived live from answers + the skill list; no
 * snapshots. Infallible: a user without answers gets zeros, not an error
 * (same contract as skill.progress for a fresh skill).
 */
export const makeGetLearningStats =
  ({ skillRepo, classRepo, quizRepo, clock }: GetLearningStatsDeps) =>
  async (input: GetLearningStatsInput): Promise<StatsOverview> => {
    const now = clock.now();
    const [skills, activity] = await Promise.all([
      skillRepo.listByUser(input.userId),
      quizRepo.findAnswerActivityByUser(input.userId),
    ]);

    // Question counts are only needed for classes touched THIS week —
    // lessonsCompletedThisWeek never looks further back.
    const currentWeek = weekStartUtc(now).getTime();
    const currentWeekClassIds = [
      ...new Set(
        activity
          .filter(
            (row) =>
              row.classId !== null &&
              weekStartUtc(row.createdAt).getTime() === currentWeek,
          )
          .map((row) => row.classId as number),
      ),
    ];
    const counts =
      currentWeekClassIds.length > 0
        ? await classRepo.findQuestionCountsByClassIds(currentWeekClassIds)
        : [];

    return {
      weeklyActiveSkills: weeklyActiveSkills(activity, statsWindow(now)),
      currentStreakDays: currentStreakDays(activity, now),
      answersThisWeek: answersInCurrentWeek(activity, now),
      lessonsCompletedThisWeek: lessonsCompletedThisWeek(
        activity,
        now,
        new Map(counts.map((c) => [c.classId, c.questionCount])),
      ),
      skills: skills.map((skill) => ({
        skillId: skill.id,
        topic: skill.topic,
        lessonCount: skill.lessonCount,
        completedLessons: skill.completedLessons,
        lastActivityAt: skill.lastActivityAt,
      })),
    };
  };
