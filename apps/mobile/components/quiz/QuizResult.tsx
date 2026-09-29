import { Button } from '@atomics/button';
import { Text } from '@atomics/text';
import { cn } from '@/lib/utils';
import { FC } from 'react';
import { ScrollView, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Question, QuizSubmitResult } from '@/types/quiz';
import { useQuizStore } from '@/store/quiz.store';
import { useColorScheme } from 'nativewind';
import { codeSegments } from '@/lib/rich-text';

/**
 * Full-screen post-quiz review: one vertical list, numbered questions, the
 * right answer in a green block — plus the user's answer in a red block on
 * misses. Color is the verdict; nothing else is colored.
 */
/** Inline-code chip sizing inside the review list; mono face comes from codeSegments. */
const REVIEW_CODE: TextStyle = { fontSize: 13, borderRadius: 4 };

export const QuizResult: FC<{
  result: QuizSubmitResult;
  questions: Question[];
  onContinue: () => void;
}> = ({ result, questions, onContinue }) => {
  const insets = useSafeAreaInsets();
  const answers = useQuizStore((state) => state.answers);
  const { colorScheme } = useColorScheme();

  const textById: Record<number, string> = {};
  for (const question of questions) {
    textById[question.id] = question.text;
  }
  const answerById: Record<number, string> = {};
  for (const entry of answers) {
    if (entry.answer !== null) answerById[entry.questionId] = entry.answer;
  }

  return (
    <View className="flex-1">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}>
        {result.perQuestion.map((entry, position) => {
          const questionText = textById[entry.questionId] ?? `#${entry.questionId}`;
          return (
            <View
              key={entry.questionId}
              className="gap-3 border-hairline border-border py-5"
              style={position === 0 ? { borderTopWidth: 0 } : undefined}>
              <View className="flex-row gap-2.5">
                <Text variant="muted" className="tabular-nums">
                  {position + 1}.
                </Text>
                <Text className="flex-1 font-sans text-[15px] leading-[22px]">
                  {codeSegments(questionText, colorScheme ?? 'light', { style: REVIEW_CODE })}
                </Text>
              </View>
              <AnswerBlock
                tone="success"
                label={entry.correctAnswer ?? 'Answer key unavailable.'}
              />
              {!entry.isCorrect && (
                <AnswerBlock tone="destructive" label={answerById[entry.questionId] ?? '—'} />
              )}
            </View>
          );
        })}
      </ScrollView>

      <View className="px-6" style={{ paddingBottom: 16 + insets.bottom }}>
        <Button size="lg" onPress={onContinue}>
          <Text>Continue</Text>
        </Button>
      </View>
    </View>
  );
};

/** Solid semantic block: green = right answer, red = the answer given. */
const AnswerBlock: FC<{ tone: 'success' | 'destructive'; label: string }> = ({ tone, label }) => (
  <View
    className={cn('rounded-lg px-4 py-3', tone === 'success' ? 'bg-success' : 'bg-destructive')}>
    <Text
      className={cn(
        'text-[15px] leading-[21px]',
        tone === 'success' ? 'text-success-foreground' : 'text-destructive-foreground'
      )}>
      {codeSegments(label, 'light', { style: REVIEW_CODE, monochrome: true })}
    </Text>
  </View>
);
