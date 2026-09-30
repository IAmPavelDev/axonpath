import { Button } from '@atomics/button';
import { Text } from '@atomics/text';
import { SkillProgress } from '@/types/skill';
import { useRouter } from 'expo-router';
import { FC } from 'react';
import { View } from 'react-native';

const toPercent = (accuracy: number) => Math.round(accuracy * 100);

/**
 * Per-lesson progress for the skill detail screen: an answered/total bar with
 * accuracy per lesson, plus a resume affordance pointing at the first lesson
 * that still has unanswered questions. Data comes from skill.progress; a
 * fresh skill (no lessons) renders nothing rather than empty chrome.
 */
export const ProgressPanel: FC<{ progress: SkillProgress }> = ({ progress }) => {
  const router = useRouter();
  const resumeClass = progress.classes.find((cls) => !cls.completed);

  if (progress.totals.lessonCount === 0) {
    return null;
  }

  return (
    <View className="gap-3 px-6 pb-6">
      <Text variant="label">Progress</Text>
      <View className="gap-3">
        {progress.classes.map((cls) => {
          const fraction =
            cls.questionCount > 0 ? Math.min(cls.answeredCount / cls.questionCount, 1) : 0;
          return (
            <View key={cls.classId} className="gap-1.5">
              <View className="flex-row items-baseline justify-between gap-3">
                <Text numberOfLines={1} className="flex-1 font-sans-medium text-[15px]">
                  {cls.title}
                </Text>
                <Text variant="meta">
                  {cls.answeredCount}/{cls.questionCount} answered
                  {cls.accuracy !== null ? ` · ${toPercent(cls.accuracy)}%` : ''}
                </Text>
              </View>
              <View className="h-1.5 overflow-hidden rounded-full bg-muted">
                <View
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${fraction * 100}%` }}
                />
              </View>
            </View>
          );
        })}
      </View>
      <Text variant="meta">
        {progress.totals.completedLessons}/{progress.totals.lessonCount}{' '}
        {progress.totals.lessonCount === 1 ? 'lesson' : 'lessons'} complete
        {progress.totals.accuracy !== null ? ` · ${toPercent(progress.totals.accuracy)}% accuracy` : ''}
      </Text>
      {resumeClass && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onPress={() => router.push(`/class/${resumeClass.classId}`)}
        >
          <Text>Resume at lesson {resumeClass.index + 1}</Text>
        </Button>
      )}
    </View>
  );
};
