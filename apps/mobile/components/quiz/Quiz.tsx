import { Button } from '@atomics/button';
import { Icon } from '@atomics/icon';
import { Text } from '@atomics/text';
import { KeyboardAvoidingView } from '@atomics/keyboard-avoiding-view';
import { Textarea } from '@atomics/textarea';
import { QuestionType, Question as QuestionDataType, QuizSubmitResult } from '@/types/quiz';
import { cn } from '@/lib/utils';
import { useColorScheme } from 'nativewind';
import { codeSegments } from '@/lib/rich-text';
import { Check, X } from 'lucide-react-native';
import { FC, useLayoutEffect } from 'react';
import { Pressable, ScrollView, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuizStore } from '@/store/quiz.store';

const TYPE_LABEL: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: 'Multiple choice',
  TRUE_FALSE: 'True or false',
  OPEN_ENDED: 'Open answer',
};

/** Inline-code chip sizing inside quiz prose; mono face + colors come from codeSegments. */
const QUESTION_CODE: TextStyle = { fontSize: 17, borderRadius: 5 };
const CHOICE_CODE: TextStyle = { fontSize: 13, borderRadius: 4 };

type QuestionResultEntry = QuizSubmitResult['perQuestion'][number];
/**
 * One page, two modes. Before submit: every question with its options/answer
 * field in one scrollable list. After submit (`result` non-null): the same
 * list locked, the options themselves carrying the verdict — green for the
 * right answer, red for the learner's miss — plus a small Right/Wrong badge
 * beside the question label ("Grading…" while an open-ended grade is in
 * flight). No carousel — a plain vertical ScrollView keeps focus, scrolling
 * and the keyboard interactions trivial and reliable.
 */
export const Quiz: FC<{
  questions: QuestionDataType[];
  classId: number;
  /** Non-null once the quiz is submitted — verdict mode, form locked. */
  result: QuizSubmitResult | null;
  submitPending: boolean;
  onSubmit: () => void;
  onContinue: () => void;
}> = ({ questions, classId, result, submitPending, onSubmit, onContinue }) => {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const { setQuestions, answers, setAnswer } = useQuizStore();

  useLayoutEffect(() => {
    setQuestions(classId, questions);
  }, [classId, questions]);

  const submitted = result !== null;
  const answerOf = (questionId: number) =>
    answers.find((a) => a.questionId === questionId)?.answer ?? null;
  const unanswered = answers.filter((a) => a.answer === null).length;
  const entryOf = (questionId: number) =>
    result?.perQuestion.find((p) => p.questionId === questionId);
  const pendingGrading = submitted && result.perQuestion.some((p) => p.isCorrect === null);

  if (questions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text variant="muted">No questions for this lesson yet.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled">
        {submitted && (
          <View className="pb-4">
            <Text className="font-sans-medium text-[22px] leading-[28px] tracking-tight">
              Quiz results
            </Text>
            <Text variant="muted" className="mt-1 tabular-nums">
              {result.score} of {result.total} correct
              {pendingGrading ? ' · open answers still grading' : ''}
            </Text>
          </View>
        )}

        {questions.map((question, position) => {
          const entry = entryOf(question.id);
          const verdict = submitted && entry ? verdictOf(entry) : null;
          return (
            <View
              key={question.id}
              className="border-hairline border-border py-5"
              style={position === 0 ? { borderTopWidth: 0 } : undefined}>
              <View className="flex-row items-center gap-2">
                <Text variant="label" className="tabular-nums">
                  {position + 1}/{questions.length} · {TYPE_LABEL[question.type]}
                </Text>
                {verdict && <VerdictBadge verdict={verdict} />}
              </View>
              <Text className="mt-3 font-sans-medium text-[22px] leading-[30px] tracking-tight">
                {codeSegments(question.text, colorScheme ?? 'light', { style: QUESTION_CODE })}
              </Text>

              {question.type === QuestionType.OPEN_ENDED ? (
                <Textarea
                  value={
                    (submitted
                      ? (entry?.userAnswer ?? answerOf(question.id))
                      : answerOf(question.id)) ?? ''
                  }
                  onChangeText={(value) => setAnswer(question.id, value)}
                  placeholder="Write your answer…"
                  editable={!submitted}
                  className={cn(
                    'mt-4 rounded-lg',
                    verdict === 'right' && 'border-success',
                    verdict === 'wrong' && 'border-destructive'
                  )}
                />
              ) : (
                <View className="mt-4 gap-3">
                  {(question.type === QuestionType.TRUE_FALSE
                    ? ['True', 'False']
                    : question.choices
                  ).map((option) => {
                    // Post-submit the tiles carry the verdict themselves:
                    // green = right answer, red = the learner's miss.
                    const tone = !verdict
                      ? undefined
                      : option === entry?.correctAnswer
                        ? ('success' as const)
                        : option === entry?.userAnswer
                          ? ('destructive' as const)
                          : undefined;
                    return (
                      <OptionTile
                        key={option}
                        label={option}
                        selected={answerOf(question.id) === option}
                        tone={tone}
                        disabled={submitted}
                        onPress={() =>
                          setAnswer(question.id, answerOf(question.id) === option ? null : option)
                        }
                      />
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View
        className="flex-row items-center gap-3 px-6 pt-3"
        style={{ paddingBottom: 16 + insets.bottom }}>
        {submitted ? (
          <Button size="lg" className="flex-1" onPress={onContinue}>
            <Text>Continue</Text>
          </Button>
        ) : (
          <Button
            size="lg"
            className="flex-1"
            disabled={unanswered > 0 || submitPending}
            onPress={onSubmit}>
            <Text>
              {submitPending
                ? 'Checking…'
                : unanswered > 0
                  ? `${unanswered} unanswered`
                  : 'Submit answers'}
            </Text>
          </Button>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

type QuestionVerdict = 'right' | 'wrong' | 'grading';

const verdictOf = (entry: QuestionResultEntry): QuestionVerdict =>
  entry.isCorrect === null ? 'grading' : entry.isCorrect ? 'right' : 'wrong';

/**
 * Small verdict beside the question label: green Right, red Wrong, muted
 * Grading… while an open-ended AI grade is still in flight.
 */
const VerdictBadge: FC<{ verdict: QuestionVerdict }> = ({ verdict }) => (
  <Text
    variant="label"
    className={cn(
      verdict === 'right' && 'text-success',
      verdict === 'wrong' && 'text-destructive',
      verdict === 'grading' && 'text-muted-foreground'
    )}>
    {verdict === 'right' ? 'Right' : verdict === 'wrong' ? 'Wrong' : 'Grading…'}
  </Text>
);
/**
 * Option tile. Selection is a full monochrome inversion — the strongest
 * binary signal this design system has, no color required. Post-submit the
 * tile carries the verdict instead: green = right answer, red = the miss.
 */
const VERDICT_TILE: Record<
  'success' | 'destructive',
  { tile: string; text: string; icon: string }
> = {
  success: {
    tile: 'bg-success',
    text: 'text-success-foreground',
    icon: 'text-success-foreground',
  },
  destructive: {
    tile: 'bg-destructive',
    text: 'text-destructive-foreground',
    icon: 'text-destructive-foreground',
  },
};

const OptionTile: FC<{
  label: string;
  selected: boolean;
  /** Post-submit verdict tone; set tiles render read-only colored. */
  tone?: 'success' | 'destructive';
  disabled?: boolean;
  onPress: () => void;
}> = ({ label, selected, tone, disabled = false, onPress }) => {
  const { colorScheme } = useColorScheme();
  const styles = tone ? VERDICT_TILE[tone] : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : {}}
      onPress={onPress}
      disabled={disabled}
      className={cn(
        'flex-row items-center gap-3 rounded-lg px-4 py-3.5',
        styles
          ? styles.tile
          : selected
            ? 'bg-primary'
            : 'border border-foreground/15 bg-background active:bg-accent'
      )}>
      <Text
        className={cn(
          'flex-1 text-[15px] leading-5',
          styles ? styles.text : selected ? 'text-primary-foreground' : 'text-foreground'
        )}>
        {codeSegments(label, colorScheme ?? 'light', {
          style: CHOICE_CODE,
          monochrome: selected || !!styles,
        })}
      </Text>
      {styles && tone === 'success' && (
        <Icon as={Check} size={16} className={styles.icon} strokeWidth={2.5} />
      )}
      {styles && tone === 'destructive' && (
        <Icon as={X} size={16} className={styles.icon} strokeWidth={2.5} />
      )}
      {!styles && selected && (
        <Icon as={Check} size={16} className="text-primary-foreground" strokeWidth={2.5} />
      )}
    </Pressable>
  );
};
