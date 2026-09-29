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
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  FlatList,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextStyle,
  type ScrollViewProps,
} from 'react-native';
import {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useQuizStore } from '@/store/quiz.store';
import { codeSegments } from '@/lib/rich-text';
import { Timeout } from '@/types/global';

const AUTO_ADVANCE_MS = 340;

/** Inline-code chip sizing inside quiz prose; mono face + colors come from codeSegments. */
const QUESTION_CODE: TextStyle = { fontSize: 17, borderRadius: 5 };
const CHOICE_CODE: TextStyle = { fontSize: 13, borderRadius: 4 };

const TYPE_LABEL: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: 'Multiple choice',
  TRUE_FALSE: 'True or false',
  OPEN_ENDED: 'Open answer',
};

export const Quiz: FC<{
  questions: QuestionDataType[];
  classId: number;
  /** Fired with the submit result; the parent screen renders the result page. */
  onCompleted: (result: QuizSubmitResult) => void;
}> = (props) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const { setQuestions, questions, answers, setAnswer } = useQuizStore();
  const classQuestionsList = questions[props.classId] ?? [];
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<QuestionDataType>>(null);
  const advanceTimer = useRef<Timeout>(0);
  // RN 0.86 + React 19: VirtualizedList attaches its ScrollView ref via
  // cloneElement, whose reserved `ref` never reaches the function-component
  // ScrollViewWrapper — so the list's internal ref stays null and every
  // programmatic scroll (scrollToIndex/scrollToOffset) silently no-ops.
  // Capture the instance ourselves through the scrollViewRef prop instead.
  const scrollRef = useRef<ScrollView | null>(null);
  // RN's generated d.ts narrows RefSetter to RefObject; the runtime accepts a
  // nullable-current ref object, hence the cast.
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <ScrollView {...props} scrollViewRef={scrollRef as RefObject<ScrollView>} />
    ),
    []
  );

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
    onSuccess: (result) => {
      props.onCompleted(result);
    },
  });

  const total = classQuestionsList.length;
  const unanswered = answers.filter((a) => a.answer === null).length;
  const isLast = index >= total - 1;

  const goTo = useCallback(
    (page: number) => {
      const target = Math.min(Math.max(0, page), Math.max(0, total - 1));
      if (scrollRef.current) {
        // Native: the list's internal scrollToIndex/scrollToOffset early-return
        // on its lost ref, so scroll the ScrollView instance directly. Each
        // page is exactly `width` wide (getItemLayout), so this is exact.
        scrollRef.current.scrollTo({ x: target * width, y: 0, animated: true });
      } else {
        // Web (react-native-web): the list's own ref works there.
        listRef.current?.scrollToOffset({ offset: target * width, animated: true });
      }
      setIndex(target);
    },
    [total, width]
  );

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
      <View className="h-1 bg-muted">
        <Animated.View
          style={[
            {
              flex: 1,
              backgroundColor: THEME[colorScheme ?? 'light'].foreground,
              transformOrigin: 'left',
            },
          ]}
        />
      </View>

      <Text variant="meta" className="px-6 pb-2 pt-3 tabular-nums">
        Question {index + 1} of {total}
      </Text>

      <FlatList
        ref={listRef}
        data={classQuestionsList}
        renderScrollComponent={Platform.OS === 'web' ? undefined : renderScrollComponent}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(question) => question.id.toString()}
        getItemLayout={(_, page) => ({ length: width, offset: width * page, index: page })}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={({ item: question }) => (
          <View style={{ width }} className="flex-1 px-6 pt-4">
            <Text variant="label">{TYPE_LABEL[question.type]}</Text>
            <Text className="mt-3 font-sans-medium text-[22px] leading-[30px] tracking-tight">
              {codeSegments(question.text, colorScheme ?? 'light', { style: QUESTION_CODE })}
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
  const { colorScheme } = useColorScheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : {}}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-lg px-4 py-3.5',
        selected ? 'bg-primary' : 'border border-foreground/15 bg-background active:bg-accent'
      )}>
      <Text
        className={cn(
          'flex-1 text-[15px] leading-5',
          selected ? 'text-primary-foreground' : 'text-foreground'
        )}>
        {codeSegments(label, colorScheme ?? 'light', { style: CHOICE_CODE, monochrome: selected })}
      </Text>
      {selected && (
        <Icon as={Check} size={16} className="text-primary-foreground" strokeWidth={2.5} />
      )}
    </Pressable>
  );
};
