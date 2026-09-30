import { Text } from '@atomics/text';
import { useRouter } from 'expo-router';
import { FC } from 'react';
import { Pressable, View } from 'react-native';
import type { SkillMistake } from '@/types/skill';

/**
 * Review list for a skill: the learner's latest wrong answer per question,
 * newest first. Your answer in the destructive color, the correct choice in
 * success (MC/TF only — open-ended shows grader feedback instead; the model
 * answer never leaves the server), tap-through to the lesson it came from.
 * Renders nothing when there is nothing to review.
 */
export const MistakeList: FC<{ mistakes: SkillMistake[] }> = ({ mistakes }) => {
  const router = useRouter();

  if (mistakes.length === 0) {
    return null;
  }

  return (
    <View className="gap-3 px-6 pb-6">
      <Text variant="label">Review mistakes ({mistakes.length})</Text>
      <View className="gap-2">
        {mistakes.map((mistake) => (
          <Pressable
            key={mistake.questionId}
            className="gap-1 rounded-lg bg-muted px-3 py-2.5 active:opacity-60"
            disabled={mistake.classId === null}
            onPress={() => {
              if (mistake.classId !== null) {
                router.push(`/class/${mistake.classId}`);
              }
            }}
          >
            <Text className="font-sans text-[15px] leading-[21px]">
              {mistake.questionText}
            </Text>
            <Text className="text-[13px] text-destructive">
              Your answer: {mistake.yourAnswer}
            </Text>
            {mistake.correctAnswer !== null && (
              <Text className="text-[13px] text-success">
                Correct: {mistake.correctAnswer}
              </Text>
            )}
            {mistake.feedback !== null && (
              <Text className="italic text-[13px] text-muted-foreground">
                {mistake.feedback}
              </Text>
            )}
            {mistake.classId !== null && mistake.classIndex !== null && (
              <Text variant="meta">Lesson {mistake.classIndex + 1} →</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
};
