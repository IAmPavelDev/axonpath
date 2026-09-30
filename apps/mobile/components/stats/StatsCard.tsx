import { Text } from '@atomics/text';
import { View } from 'react-native';
import { FC } from 'react';
import type { StatsOverview } from '@/types/stats';

const StatFigure: FC<{ value: number; label: string }> = ({ value, label }) => (
  <View className="flex-1 gap-0.5">
    <Text className="font-sans text-[26px] leading-[32px] tabular-nums tracking-tight">
      {value}
    </Text>
    <Text variant="muted">{label}</Text>
  </View>
);

/**
 * Home-screen learning stats: momentum at a glance — day streak, this week's
 * completed lessons and answers, and per-skill progress totals. Renders
 * nothing until the user has at least one skill (fresh accounts get no
 * chrome, same rule as ProgressPanel).
 */
export const StatsCard: FC<{ stats: StatsOverview }> = ({ stats }) => {
  if (stats.skills.length === 0) {
    return null;
  }

  return (
    <View className="gap-3 px-6 pb-5">
      <Text variant="label">Your learning</Text>
      <View className="flex-row gap-4">
        <StatFigure value={stats.currentStreakDays} label="day streak" />
        <StatFigure
          value={stats.lessonsCompletedThisWeek}
          label="lessons this week"
        />
        <StatFigure value={stats.answersThisWeek} label="answers this week" />
      </View>
      <View className="gap-1">
        {stats.skills.map((skill) => (
          <View key={skill.skillId} className="flex-row items-center gap-2">
            <Text className="flex-shrink font-sans text-[15px] leading-[21px]">
              {skill.topic}
            </Text>
            <Text variant="meta">
              {skill.completedLessons}/{skill.lessonCount} lessons
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};
