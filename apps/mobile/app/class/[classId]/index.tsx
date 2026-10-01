import { ClassConspect } from '@components/class/ClassConspect';
import { QaComposer } from '@components/class/QaComposer';
import { Quiz } from '@components/quiz/Quiz';
import { QuizResult } from '@components/quiz/QuizResult';
import { ScreenHeader } from '@components/screen-header';
import { SegmentedControl } from '@atomics/segmented-control';
import { Skeleton } from '@atomics/skeleton';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { Text } from '@atomics/text';
import { BackHandler, Pressable, View } from 'react-native';
import { Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useClassQa } from '@/hooks/use-class-qa';

type Tab = 'conspect' | 'quiz';

/**
 * Quiz-flow phase owned by this screen: 'quiz' → 'result' once the submit
 * result arrives (rendered full-screen from local state). Continue leaves
 * for the skill's lessons list — the backend composes the next lesson on
 * its own, surfaced by the skill's preparing status.
 */
type Phase = 'quiz' | 'result';

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
    useQuizStore((state) => (classIdNum !== undefined ? state.questions[classIdNum] : undefined)) ??
    [];

  // router.replace to another lesson can reuse this screen instance —
  // restart the quiz flow for the new lesson.
  useEffect(() => {
    setPhase('quiz');
    setQuizResult(null);
  }, [classIdNum]);

  const { data, isLoading, isError, error } = useQuery<ClassById, Error>({
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

  if (phase === 'result' && quizResult) {
    return (
      <View className="flex-1">
        <View className="px-6 pt-1">
          <ScreenHeader onBack={() => router.back()} className="-mx-3" />
        </View>
        <QuizResult
          result={quizResult}
          questions={quizQuestions}
          onContinue={() => router.replace(`/skill/${data.skillId}`)}
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
            <Text className="font-sans-medium text-[20px] leading-[26px] tracking-tight">
              {data.title}
            </Text>
          </View>
          <Animated.View style={expandedStyle} className="absolute inset-0">
            <Text className="font-sans-medium text-[20px] leading-[26px] tracking-tight">
              {data.title}
            </Text>
          </Animated.View>
          <Animated.View style={collapsedStyle} className="absolute inset-0">
            <Text
              numberOfLines={1}
              className="font-sans-medium text-[15px] leading-[24px] tracking-tight">
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
  const scrollRef = useRef<Animated.ScrollView>(null);
  const qa = useClassQa(classData.id);

  // Anchor mode: pill → banner → every chunk is tap-to-anchor; the composer
  // opens on the chosen chunk. Follow-ups reuse the composer without mode.
  const [anchorMode, setAnchorMode] = useState(false);
  const [composer, setComposer] = useState<{
    anchor: number;
    excerpt: string;
    /** True when the excerpt is the learner's verbatim selection (long-press Ask AI). */
    selected: boolean;
  } | null>(null);

  /** Top-level y offsets, keyed by chunk index — targets for scroll-into-view. */
  const groupYs = useRef(new Map<number, { chunk?: number; qa?: number }>());
  const registerLayout = (slot: 'chunk' | 'qa') => (index: number, y: number) => {
    const entry = groupYs.current.get(index) ?? {};
    entry[slot] = y;
    groupYs.current.set(index, entry);
  };

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

  /** Bring the QA group after `anchor` into view (waits one layout pass). */
  const scrollToAnchor = (anchor: number) => {
    setTimeout(() => {
      const group = groupYs.current.get(anchor);
      const y = group?.qa ?? group?.chunk ?? 0;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }, 150);
  };

  const submitQuestion = (question: string) => {
    if (!composer) return;
    const { anchor, excerpt, selected } = composer;
    qa.ask(anchor, question, selected ? excerpt : null);
    setComposer(null);
    setAnchorMode(false);
    scrollToAnchor(anchor);
  };

  // Hardware back cancels anchor mode (the composer's Modal handles its own back).
  useEffect(() => {
    if (!anchorMode) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setAnchorMode(false);
      return true;
    });
    return () => sub.remove();
  }, [anchorMode]);

  const ink = THEME[colorScheme];
  const accent = ink.primary;

  return (
    <View className="flex-1">
      <View className="h-1 bg-muted">
        <Animated.View style={fillStyle} />
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 96 }}>
        <ClassConspect
          contentMd={classData.contentMd}
          anchorMode={anchorMode}
          onAnchorChunk={(index, excerpt) => setComposer({ anchor: index, excerpt, selected: false })}
          qaByAnchor={qa.blocksByAnchor}
          onAskSelection={(index, text) => setComposer({ anchor: index, excerpt: text, selected: true })}
          onRegisterChunkLayout={registerLayout('chunk')}
          onRegisterQaLayout={registerLayout('qa')}
          onFollowUp={(index, excerpt) => setComposer({ anchor: index, excerpt, selected: false })}
          onRetryTemp={qa.retryTemp}
          onAskAgain={(index, question) => {
            qa.ask(index, question);
            scrollToAnchor(index);
          }}
        />
      </Animated.ScrollView>

      {anchorMode ? (
        <View
          className="absolute inset-x-5 top-3 flex-row items-center gap-3 rounded-lg border-hairline border-border bg-card px-4 py-3"
          style={{ elevation: 8 }}>
          <Sparkles size={16} color={accent} />
          <Text className="flex-1 font-sans-medium text-[14px] leading-[20px] text-card-foreground">
            Tap the paragraph to anchor your question
          </Text>
          <Pressable
            onPress={() => setAnchorMode(false)}
            accessibilityLabel="Cancel anchor mode"
            className="p-1 active:opacity-60">
            <X size={18} color={ink.mutedForeground} />
          </Pressable>
        </View>
      ) : null}

      <Pressable
        onPress={() => setAnchorMode((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={anchorMode ? 'Cancel asking the AI' : 'Ask the AI about this lesson'}
        className={`absolute bottom-6 right-5 flex-row items-center gap-2 rounded-full px-4 py-3 ${anchorMode ? 'bg-secondary' : 'bg-primary'}`}
        style={{ elevation: 6 }}>
        <Sparkles size={16} color={anchorMode ? ink.secondaryForeground : ink.primaryForeground} />
        <Text
          className={`font-sans-semibold text-[15px] ${anchorMode ? 'text-secondary-foreground' : 'text-primary-foreground'}`}>
          {anchorMode ? 'Cancel' : 'Ask AI'}
        </Text>
      </Pressable>

      <QaComposer
        visible={composer !== null}
        excerpt={composer?.excerpt ?? null}
        onClose={() => setComposer(null)}
        onSubmit={submitQuestion}
      />
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
    // Graded scores for open-ended answers land server-side after the
    // submit; remounting this screen (returning to the lesson) pulls them.
    refetchOnMount: 'always',
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

  return <Quiz questions={data} classId={classId} onCompleted={onCompleted} />;
}
