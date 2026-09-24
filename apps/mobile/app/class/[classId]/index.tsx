import { Button } from '@atomics/button';
import { ClassConspect } from '@components/class/ClassConspect';
import { Quiz } from '@components/quiz/Quiz';
import { QuizResult } from '@components/quiz/QuizResult';
import { ScreenHeader } from '@components/screen-header';
import { PulseDot } from '@atomics/pulse-dot';
import { SegmentedControl } from '@atomics/segmented-control';
import { Skeleton } from '@atomics/skeleton';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { Text } from '@atomics/text';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  clamp,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useQuizStore } from '@/store/quiz.store';
import type { QuizSubmitResult } from '@/types/quiz';
import type { ClassById } from '@/types/class';
import rpc from '@/utils/rpc';

type Tab = 'conspect' | 'quiz';

/**
 * Quiz-flow phase owned by this screen: 'quiz' → 'result' once the submit
 * result arrives (rendered full-screen from local state), 'result' →
 * 'generating' on continue, where the next lesson is awaited and auto-opened.
 */
type Phase = 'quiz' | 'result' | 'generating';

const GENERATING_POLL_MS = 2500;
const GENERATING_TIMEOUT_MS = 90_000;

/** Collapse runs over the first 140px of scroll. */
const COLLAPSE_RANGE = 140;
const COLLAPSED_HEIGHT = 24;
/** Expanded height is measured from the rendered title; this only covers pre-measurement. */
const EXPANDED_HEIGHT_FALLBACK = 64;

export default function ClassScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ classId?: string | string[] }>();
  const { colorScheme } = useColorScheme();

  const classIdNum = useMemo(() => {
    const idStr = Array.isArray(params.classId) ? params.classId?.[0] : params.classId;
    const n = Number(idStr);
    return Number.isFinite(n) ? n : undefined;
  }, [params.classId]);

  const [tab, setTab] = useState<Tab>('conspect');
  const [phase, setPhase] = useState<Phase>('quiz');
  const [quizResult, setQuizResult] = useState<QuizSubmitResult | null>(null);
  const quizQuestions =
    useQuizStore(
      (state) => (classIdNum !== undefined ? state.questions[classIdNum] : undefined)
    ) ?? [];

  // router.replace to another lesson can reuse this screen instance —
  // restart the quiz flow for the new lesson.
  useEffect(() => {
    setPhase('quiz');
    setQuizResult(null);
  }, [classIdNum]);

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery<ClassById, Error>({
    queryKey: ['classById', classIdNum],
    queryFn: () => rpc.class.get({ id: classIdNum! }),
    enabled: classIdNum !== undefined,
    staleTime: 60_000,
  });

  const scrollY = useSharedValue(0);
  const [expandedHeight, setExpandedHeight] = useState(EXPANDED_HEIGHT_FALLBACK);

  // Collapse progress 0..1 over the first pixels of scroll.
  const collapse = useDerivedValue(() => clamp(scrollY.value / COLLAPSE_RANGE, 0, 1));

  const blockStyle = useAnimatedStyle(() => ({
    height: interpolate(collapse.value, [0, 1], [expandedHeight, COLLAPSED_HEIGHT]),
  }));

  // Expanded title vanishes fast; the collapsed one returns only in the
  // final 10% — the font swap happens in between, behind full transparency.
  const expandedStyle = useAnimatedStyle(() => ({
    opacity: 1 - clamp(collapse.value / 0.22, 0, 1),
  }));
  const collapsedStyle = useAnimatedStyle(() => ({
    opacity: clamp((collapse.value - 0.9) / 0.1, 0, 1),
  }));

  if (classIdNum === undefined) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text variant="muted">Invalid or missing class id.</Text>
      </View>
    );
  }

  if (isLoading || !data) {
    return (
      <View className="flex-1 px-6 pt-10">
        <Skeleton className="mb-2 h-6 w-3/4 rounded-md" />
        <Skeleton className="h-6 w-1/2 rounded-md" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text variant="muted">Failed to load class: {error?.message ?? 'Unknown error'}</Text>
      </View>
    );
  }

  if (phase === 'generating') {
    return <GeneratingView skillId={data.skillId} />;
  }
  if (phase === 'result' && quizResult) {
    return (
      <View className="flex-1">
        <View className="px-6 pt-1">
          <ScreenHeader onBack={() => router.back()} className="-mx-3" />
        </View>
        <QuizResult
          result={quizResult}
          questions={quizQuestions}
          onContinue={() => setPhase('generating')}
        />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <View className="px-6 pt-1">
        <ScreenHeader onBack={() => router.back()} className="-mx-3" />
      </View>
      <View>
        <Animated.View style={blockStyle} className="mx-6 overflow-hidden">
          {/* Invisible natural-height measure layer for the expanded title. */}
          <View
            className="absolute inset-x-0 opacity-0"
            pointerEvents="none"
            onLayout={(e) => {
              const h = Math.ceil(e.nativeEvent.layout.height);
              if (h > 0 && h !== expandedHeight) setExpandedHeight(h);
            }}>
            <Text className="font-serif-medium text-[20px] leading-[26px] tracking-tight">
              {data.title}
            </Text>
          </View>
          <Animated.View style={expandedStyle} className="absolute inset-0">
            <Text className="font-serif-medium text-[20px] leading-[26px] tracking-tight">
              {data.title}
            </Text>
          </Animated.View>
          <Animated.View style={collapsedStyle} className="absolute inset-0">
            <Text numberOfLines={1} className="font-serif-medium text-[15px] leading-[24px] tracking-tight">
              {data.title}
            </Text>
          </Animated.View>
        </Animated.View>
      </View>

      <View className="border-hairline border-border px-4 pb-2.5 pt-1">
        <SegmentedControl
          options={[
            { value: 'conspect', label: 'Conspect' },
            { value: 'quiz', label: 'Quiz' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {/* Both views stay mounted (hidden with display) so scroll position,
          reading progress and quiz answers survive tab flips. */}
      <View style={{ flex: 1, display: tab === 'conspect' ? 'flex' : 'none' }}>
        <ConspectView classData={data} scrollY={scrollY} colorScheme={colorScheme ?? 'light'} />
      </View>
      <View style={{ flex: 1, display: tab === 'quiz' ? 'flex' : 'none' }}>
        <QuizView
          classId={classIdNum}
          onCompleted={(result) => {
            setQuizResult(result);
            setPhase('result');
          }}
        />
      </View>
    </View>
  );
}

function ConspectView({
  classData,
  scrollY,
  colorScheme,
}: {
  classData: ClassById;
  scrollY: SharedValue<number>;
  colorScheme: 'light' | 'dark';
}) {
  // Reading progress 0..1 for the current lesson.
  const progress = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
    const max = Math.max(1, event.contentSize.height - event.layoutMeasurement.height);
    progress.value = clamp(event.contentOffset.y / max, 0, 1);
  });

  const fillStyle = useAnimatedStyle(() => ({
    flex: 1,
    backgroundColor: THEME[colorScheme].foreground,
    transform: [{ scaleX: progress.value }],
    transformOrigin: 'left',
  }));

  return (
    <View className="flex-1">
      <View className="h-1 bg-muted">
        <Animated.View style={fillStyle} />
      </View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 96 }}>
        <ClassConspect contentMd={classData.contentMd} />
      </Animated.ScrollView>
    </View>
  );
}

function QuizView({
  classId,
  onCompleted,
}: {
  classId: number;
  onCompleted: (result: QuizSubmitResult) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['quizByClassId', classId],
    queryFn: () => rpc.quiz.get({ classId }),
  });

  if (isLoading || !data) {
    return (
      <View className="flex-1 px-6 pt-6">
        <Skeleton className="mb-6 h-4 w-24 rounded-sm" />
        <Skeleton className="mb-3 h-7 w-full rounded-md" />
        <Skeleton className="mb-8 h-7 w-2/3 rounded-md" />
        <View className="gap-3">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </View>
      </View>
    );
  }

  return (
    <Quiz
      questions={data}
      classId={classId}
      onCompleted={onCompleted}
    />
  );
}

/**
 * Full-screen state after a finished quiz: the backend is composing the
 * next lesson for the skill. The first class.list response is the
 * baseline; poll until a class id outside it appears, then swap this
 * screen for the new lesson. Gives up after 90s with a way out.
 */
function GeneratingView({ skillId }: { skillId: number }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const baseline = useRef<ReadonlySet<number> | null>(null);

  const { data: classes } = useQuery({
    queryKey: ['classList', skillId],
    queryFn: () => rpc.class.list({ skillId }),
    refetchInterval: timedOut ? false : GENERATING_POLL_MS,
  });

  useEffect(() => {
    if (!classes) return;
    const known = baseline.current;
    if (!known) {
      baseline.current = new Set(classes.map((entry) => entry.id));
      return;
    }
    const next = classes.find((entry) => !known.has(entry.id));
    if (next) router.replace(`/class/${next.id}`);
  }, [classes, router]);

  useEffect(() => {
    if (timedOut) return;
    const timer = setTimeout(() => setTimedOut(true), GENERATING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [timedOut]);

  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <PulseDot className="size-2" />
      <View className="items-center gap-1.5">
        <Text className="text-center font-serif-medium text-[17px] leading-[24px] tracking-tight">
          {timedOut ? 'Still generating — check back soon.' : 'Generating your next lesson…'}
        </Text>
        {!timedOut && (
          <Text variant="muted" className="text-center">
            We're using your quiz answers to personalize it.
          </Text>
        )}
      </View>
      {timedOut && (
        <Button size="lg" onPress={() => router.replace(`/skill/${skillId}`)}>
          <Text>Back to skill</Text>
        </Button>
      )}
    </View>
  );
}
