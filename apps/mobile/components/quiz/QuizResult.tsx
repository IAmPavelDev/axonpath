import { Button } from '@atomics/button';
import { Icon } from '@atomics/icon';
import { Text } from '@atomics/text';
import { Check, X } from 'lucide-react-native';
import { FC } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Question, QuizSubmitResult } from '@/types/quiz';

const verdict = (score: number, total: number): string => {
  if (total === 0) return 'Nothing to review.';
  const ratio = score / total;
  if (ratio >= 0.8) return 'Strong recall.';
  if (ratio >= 0.5) return 'Getting there.';
  return 'Worth another pass.';
};

export const QuizResult: FC<{
  result: QuizSubmitResult;
  questions: Question[];
  onContinue: () => void;
}> = ({ result, questions, onContinue }) => {
  const insets = useSafeAreaInsets();
  const textById: Record<number, string> = {};
  for (const question of questions) {
    textById[question.id] = question.text;
  }

  return (
    <View className="flex-1">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}>
        <View className="items-center pt-8">
          <Text className="font-serif-medium tracking-tight">
            <Text className="text-[56px] leading-[60px]">{result.score}</Text>
            <Text className="text-[24px] leading-[60px] text-muted-foreground">
              {' '}
              / {result.total}
            </Text>
          </Text>

          {/* One segment per question: filled = correct. Monochrome on
              purpose — the check marks below carry the pass/fail color. */}
          <View className="mt-5 w-full flex-row gap-1">
            {Array.from({ length: result.total }, (_, segment) => (
              <View
                key={segment}
                className={`h-1.5 flex-1 rounded-full ${segment < result.score ? 'bg-foreground' : 'bg-muted'}`}
              />
            ))}
          </View>

          <Text variant="muted" className="mt-3">
            {verdict(result.score, result.total)}
          </Text>
        </View>

        <Text variant="label" className="pb-2 pt-10">
          Review
        </Text>
        <View>
          {result.perQuestion.map((entry, position) => {
            const questionText = textById[entry.questionId] ?? `#${entry.questionId}`;
            return (
              <View
                key={entry.questionId}
                className="flex-row gap-3 border-hairline border-border py-3.5"
                style={position > 0 ? { borderTopWidth: 0 } : undefined}>
                <Icon
                  as={entry.isCorrect ? Check : X}
                  size={18}
                  strokeWidth={2.25}
                  className={entry.isCorrect ? 'text-success' : 'text-destructive'}
                />
                <View className="flex-1 gap-1">
                  <Text className="font-serif text-[15px] leading-[22px]">{questionText}</Text>
                  {!entry.isCorrect && entry.correctAnswer !== null && (
                    <Text variant="muted">Answer: {entry.correctAnswer}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View className="px-6" style={{ paddingBottom: 16 + insets.bottom }}>
        <Button size="lg" onPress={onContinue}>
          <Text>Continue</Text>
        </Button>
      </View>
    </View>
  );
};
