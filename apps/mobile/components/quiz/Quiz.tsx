import { Button } from '@atomics/button';
import { Icon } from '@atomics/icon';
import { Text } from '@atomics/text';
import { Textarea } from '@atomics/textarea';
import { QuestionType, Question as QuestionDataType, QuizSubmitResult } from '@/types/quiz';
import { cn } from '@/lib/utils';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import rpc from '@/utils/rpc';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react-native';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import {
  FlatList,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { FC, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuizStore } from '@/store/quiz.store';
import { QuizResult } from './QuizResult';

const AUTO_ADVANCE_MS = 340;

const TYPE_LABEL: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: 'Multiple choice',
  TRUE_FALSE: 'True or false',
  OPEN_ENDED: 'Open answer',
};

export const Quiz: FC<{ questions: QuestionDataType[]; classId: number }> = (props) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const { setQuestions, questions, answers, setAnswer } = useQuizStore();
  const classQuestionsList = questions[props.classId] ?? [];
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<QuestionDataType>>(null);
  const advanceTimer = useRef(0);

  useLayoutEffect(() => {
    setQuestions(props.classId, props.questions);
  }, [props.classId, props.questions]);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(
      classQuestionsList.length ? (index + 1) / classQuestionsList.length : 0,
      { duration: 260 }
    );
  }, [index, classQuestionsList.length, progress]);
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  const submit = useMutation({
    mutationFn: () => {
      const submitted = answers
        .filter((a): a is { questionId: number; answer: string } => a.answer !== null)
        .map(({ questionId, answer }) => ({ questionId, answer }));
      return rpc.quiz.submit({ classId: props.classId, answers: submitted });
    },
    onSuccess: setResult,
  });

  const total = classQuestionsList.length;
  const unanswered = answers.filter((a) => a.answer === null).length;
  const isLast = index >= total - 1;

  const goTo = useCallback((page: number) => {
    const target = Math.max(0, page);
    listRef.current?.scrollToIndex({ index: target, animated: true });
    setIndex(target);
  }, []);

  const scheduleAdvance = useCallback(() => {
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      goTo(Math.min(index + 1, Math.max(0, total - 1)));
    }, AUTO_ADVANCE_MS);
  }, [goTo, index, total]);

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / width);
    if (page !== index && page >= 0 && page < total) {
      setIndex(page);
    }
  };

  const selectOption = (question: QuestionDataType, option: string) => {
    const previous = answers.find((a) => a.questionId === question.id)?.answer ?? null;
    const next = previous === option ? null : option;
    setAnswer(question.id, next);
    // Deselecting must not fling the user forward.
    if (next !== null) {
      scheduleAdvance();
    }
  };

  if (result) {
    return (
      <QuizResult
        result={result}
        questions={classQuestionsList}
        onContinue={() => router.back()}
      />
    );
  }

  if (total === 0) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text variant="muted">No questions for this lesson yet.</Text>
      </View>
    );
  }

  const answerOf = (questionId: number) =>
    answers.find((a) => a.questionId === questionId)?.answer ?? null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View className="h-0.5 bg-muted">
        <Animated.View
          style={[
            {
              flex: 1,
              backgroundColor: THEME[colorScheme ?? 'light'].foreground,
              transformOrigin: 'left',
            },
            barStyle,
          ]}
        />
      </View>

      <Text variant="meta" className="px-6 pb-2 pt-3 tabular-nums">
        Question {index + 1} of {total}
      </Text>

      <FlatList
        ref={listRef}
        data={classQuestionsList}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(question) => question.id.toString()}
        getItemLayout={(_, page) => ({ length: width, offset: width * page, index: page })}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={({ item: question }) => (
          <View style={{ width }} className="flex-1 px-6 pt-4">
            <Text variant="label">{TYPE_LABEL[question.type]}</Text>
            <Text className="mt-3 font-serif-medium text-[22px] leading-[30px] tracking-tight">
              {question.text}
            </Text>

            {question.type === QuestionType.OPEN_ENDED ? (
              <Textarea
                value={answerOf(question.id) ?? ''}
                onChangeText={(value) => setAnswer(question.id, value)}
                placeholder="Write your answer…"
                className="mt-6 rounded-lg"
              />
            ) : (
              <View className="mt-7 gap-3">
                {(question.type === QuestionType.TRUE_FALSE
                  ? ['True', 'False']
                  : question.choices
                ).map((option) => (
                  <OptionTile
                    key={option}
                    label={option}
                    selected={answerOf(question.id) === option}
                    onPress={() => selectOption(question, option)}
                  />
                ))}
              </View>
            )}
          </View>
        )}
      />

      <View
        className="flex-row items-center gap-3 px-6 pt-3"
        style={{ paddingBottom: 16 + insets.bottom }}>
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel="Previous question"
          disabled={index === 0}
          onPress={() => goTo(index - 1)}>
          <Icon as={ArrowLeft} size={18} />
        </Button>
        {isLast ? (
          <Button
            size="lg"
            className="flex-1"
            disabled={unanswered > 0 || submit.isPending}
            onPress={() => submit.mutate()}>
            <Text>
              {submit.isPending
                ? 'Checking…'
                : unanswered > 0
                  ? `${unanswered} unanswered`
                  : 'Submit answers'}
            </Text>
          </Button>
        ) : (
          <Button size="lg" className="flex-1" onPress={() => goTo(index + 1)}>
            <Text>Next question</Text>
            <Icon as={ArrowRight} size={16} className="text-primary-foreground" />
          </Button>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

/**
 * Option tile. Selection is a full monochrome inversion — the strongest
 * binary signal this design system has, no color required.
 */
const OptionTile: FC<{ label: string; selected: boolean; onPress: () => void }> = ({
  label,
  selected,
  onPress,
}) => {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : {}}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-lg px-4 py-3.5',
        selected
          ? 'bg-primary'
          : 'border-hairline border-foreground/30 bg-background active:bg-accent'
      )}>
      <Text
        className={cn(
          'flex-1 text-[15px] leading-5',
          selected ? 'text-primary-foreground' : 'text-foreground'
        )}>
        {label}
      </Text>
      {selected && (
        <Icon as={Check} size={16} className="text-primary-foreground" strokeWidth={2.5} />
      )}
    </Pressable>
  );
};
