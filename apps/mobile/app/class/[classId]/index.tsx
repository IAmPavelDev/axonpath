import { ClassConspect } from '@components/class/ClassConspect';
import { QaComposer } from '@components/class/QaComposer';
import { ConspectPlayButton } from '@components/class/ConspectPlayButton';
import { Quiz } from '@components/quiz/Quiz';
import { ScreenHeader } from '@components/screen-header';
import { SegmentedControl } from '@atomics/segmented-control';
import { Skeleton } from '@atomics/skeleton';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { Text } from '@atomics/text';
import { BackHandler, Pressable, View } from 'react-native';
import { Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
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
import { track } from '@/lib/analytics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQuizStore } from '@/store/quiz.store';
import type { QuizSubmitResult } from '@/types/quiz';
import type { ClassById } from '@/types/class';
import rpc from '@/utils/rpc';
import { useClassQa } from '@/hooks/use-class-qa';
import { useConspectSpeech } from '@/hooks/use-conspect-speech';
import type { Timeout } from '@/types/global';

type Tab = 'conspect' | 'quiz';

/** Collapse runs over the first 140px of scroll. */
const COLLAPSE_RANGE = 140;
/** Scroll offsets at or below this are layout/navigation noise (Android can
 * emit a small initial onScroll during the push transition), not user scroll
 * — the header title must not fade at open. */
const COLLAPSE_DEAD_ZONE = 24;
const COLLAPSED_HEIGHT = 24;
/** Speech scroll-follow comfort band: scroll only when the spoken word's
 * line leaves [scrollY+TOP, scrollY+height-BOTTOM], landing it a third down. */
const FOLLOW_TOP = 120;
const FOLLOW_BOTTOM = 96;
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

  // Behavior analytics state. `progress` lives here (not in ConspectView)
  // so the tab-change handler can read scroll progress synchronously.
  const progress = useSharedValue(0);
  const classViewAt = useRef(Date.now());
  const conspectFocusAt = useRef(Date.now());
  const quizFocusAt = useRef<number | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const { data, isLoading, isError, error } = useQuery<ClassById, Error>({
    queryKey: ['classById', classIdNum],
    queryFn: () => rpc.class.get({ id: classIdNum! }),
    enabled: classIdNum !== undefined,
    staleTime: 60_000,
    // While video enrichment runs the lesson is gated; poll until it lands.
    refetchInterval: (query) =>
      query.state.data?.clipStatus === 'PENDING' ? 5_000 : false,
  });

  useEffect(() => {
    if (data) {
      void track('class_view', {
        class_id: classIdNum,
        skill_id: data.skillId,
      });
    }
  }, [data, classIdNum]);

  // Leaving the screen mid-read still reports the reading session.
  useEffect(
    () => () => {
      if (tabRef.current === 'conspect') {
        void track('conspect_read', {
          class_id: classIdNum,
          seconds: Math.round((Date.now() - conspectFocusAt.current) / 1000),
          scroll_progress: Math.round(progress.value * 100) / 100,
        });
      }
    },
    // Unmount-only: the refs above are stable mirrors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleTabChange = (next: Tab) => {
    if (next === tab) return;
    const now = Date.now();
    if (tab === 'conspect') {
      void track('conspect_read', {
        class_id: classIdNum,
        seconds: Math.round((now - conspectFocusAt.current) / 1000),
        scroll_progress: Math.round(progress.value * 100) / 100,
      });
    }
    if (next === 'quiz') {
      void track('quiz_opened', {
        class_id: classIdNum,
        seconds_since_class_view: Math.round((now - classViewAt.current) / 1000),
      });
      quizFocusAt.current = now;
    } else if (next === 'conspect') {
      conspectFocusAt.current = now;
    }
    setTab(next);
  };

  const scrollY = useSharedValue(0);
  const [expandedHeight, setExpandedHeight] = useState(EXPANDED_HEIGHT_FALLBACK);
  // Dead-zone first: phantom sub-24px offsets (see COLLAPSE_DEAD_ZONE) must
  // read as exactly zero, not as a half-faded title.
  const collapse = useDerivedValue(() => {
    const y = scrollY.value;
    if (y <= COLLAPSE_DEAD_ZONE) return 0;
    return clamp((y - COLLAPSE_DEAD_ZONE) / (COLLAPSE_RANGE - COLLAPSE_DEAD_ZONE), 0, 1);
  });

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
            <Text className="font-sans-medium text-[20px] leading-[26px] tracking-tight text-foreground">
              {data.title}
            </Text>
          </View>
          <Animated.View style={expandedStyle} className="absolute inset-0">
            <Text className="font-sans-medium text-[20px] leading-[26px] tracking-tight text-foreground">
              {data.title}
            </Text>
          </Animated.View>
          <Animated.View style={collapsedStyle} className="absolute inset-0">
            <Text
              numberOfLines={1}
              className="font-sans-medium text-[15px] leading-[24px] tracking-tight text-foreground">
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
          onChange={handleTabChange}
        />
      </View>

      {/* Both views stay mounted (hidden with display) so scroll position,
          reading progress and quiz answers survive tab flips. */}
      <View style={{ flex: 1, display: tab === 'conspect' ? 'flex' : 'none' }}>
        <ConspectView
          classData={data}
          scrollY={scrollY}
          progress={progress}
          colorScheme={colorScheme ?? 'light'}
          visible={tab === 'conspect'}
        />
      </View>
      <View style={{ flex: 1, display: tab === 'quiz' ? 'flex' : 'none' }}>
        <QuizView
          classId={classIdNum}
          quizFocusAt={quizFocusAt}
          onContinue={() => router.replace(`/skill/${data.skillId}`)}
        />
      </View>
    </View>
  );
}

function ConspectView({
  classData,
  scrollY,
  progress,
  colorScheme,
  visible,
}: {
  classData: ClassById;
  scrollY: SharedValue<number>;
  /** Owned by ClassScreen so analytics can read it on tab flips. */
  progress: SharedValue<number>;
  colorScheme: 'light' | 'dark';
  /** False while the quiz tab covers this view (display flip, still mounted). */
  visible: boolean;
}) {
  const scrollRef = useRef<Animated.ScrollView>(null);
  const qa = useClassQa(classData.id);
  const speech = useConspectSpeech(classData.contentMd, visible, classData.baseLanguage);
  /** Active word's y within its chunk, reported by HighlightedChunk. */
  const wordYInChunk = useRef<number | null>(null);
  const lastSpokenChunk = useRef(-1);
  const viewportH = useRef(0);

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

  // Insertion animation window: conspect layout animations run only for ~2s
  // after an ask, so tab flips and unrelated reflows never animate.
  const [insertionFx, setInsertionFx] = useState(false);
  const insertionFxTimer = useRef<Timeout>(0);
  useEffect(() => () => clearTimeout(insertionFxTimer.current), []);
  const pulseInsertionFx = () => {
    setInsertionFx(true);
    clearTimeout(insertionFxTimer.current);
    insertionFxTimer.current = setTimeout(() => setInsertionFx(false), 2200);
  };


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

  // Scroll-follow: while read-aloud plays, keep the spoken word's line on
  // screen — only when it leaves the comfort band, so reading ahead by hand
  // within a paragraph is never fought. On a chunk switch the word y is not
  // measured yet, and the chunk top is the right target anyway.
  useEffect(() => {
    if (!visible || speech.status !== 'playing' || speech.wordIndex < 0) return;
    const word = speech.plan.words[speech.wordIndex];
    if (!word) return;
    const chunkChanged = word.chunk !== lastSpokenChunk.current;
    lastSpokenChunk.current = word.chunk;
    const chunkY = groupYs.current.get(word.chunk)?.chunk;
    if (chunkY === undefined) return;
    const vh = viewportH.current;
    if (vh <= 0) return;
    const wordY = chunkChanged ? null : wordYInChunk.current;
    const target = chunkY + (wordY ?? 0);
    const y = scrollY.value;
    if (target >= y + FOLLOW_TOP && target <= y + vh - FOLLOW_BOTTOM) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, target - vh * 0.33), animated: true });
  }, [speech.wordIndex, speech.status, speech.plan, visible, scrollY]);

  const submitQuestion = (question: string) => {
    if (!composer) return;
    const { anchor, excerpt, selected } = composer;
    qa.ask(anchor, question, selected ? excerpt : null);
    setComposer(null);
    setAnchorMode(false);
    pulseInsertionFx();
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
  const clipsByAnchor = useMemo(
    () => new Map((classData.videoClips ?? []).map((clip) => [clip.anchorParagraph, clip])),
    [classData.videoClips],
  );

  // Lesson gate: video enrichment is part of the lesson, so the reader stays
  // behind this screen until clips settle. On give-up the status becomes
  // SKIPPED and the lesson opens with no hint a video was ever planned.
  if (classData.clipStatus === 'PENDING') {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-8">
        <Text variant="body" className="text-center">
          Preparing your lesson…
        </Text>
        <Text variant="muted" className="text-center text-[13px]">
          Finding a video that explains this well. Usually takes a minute.
        </Text>
      </View>
    );
  }
  return (
    <View className="flex-1">
      <View className="h-1 bg-muted">
        <Animated.View style={fillStyle} />
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 96 }}>
        <ClassConspect
          contentMd={classData.contentMd}
          anchorMode={anchorMode}
          onAnchorChunk={(index, excerpt) =>
            setComposer({ anchor: index, excerpt, selected: false })
          }
          qaByAnchor={qa.blocksByAnchor}
          clipsByAnchor={clipsByAnchor}
          speechView={
            speech.wordIndex >= 0
              ? { plan: speech.plan, activeWordIndex: speech.wordIndex }
              : undefined
          }
          onActiveWordLayout={(y) => {
            wordYInChunk.current = y;
          }}
          animateInsertions={insertionFx}
          onAskSelection={(index, text) =>
            setComposer({ anchor: index, excerpt: text, selected: true })
          }
          onRegisterChunkLayout={registerLayout('chunk')}
          onRegisterQaLayout={registerLayout('qa')}
          onFollowUp={(index, excerpt) => setComposer({ anchor: index, excerpt, selected: false })}
          onRetryTemp={qa.retryTemp}
          onAskAgain={(block) => qa.askAgain(block)}
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

      {!anchorMode && speech.hasAudio ? (
        <ConspectPlayButton status={speech.status} onPress={speech.toggle} />
      ) : null}

      <QaComposer
        visible={composer !== null}
        excerpt={composer?.excerpt ?? null}
        onClose={() => setComposer(null)}
        onSubmit={submitQuestion}
      />
    </View>
  );
}

const GRADING_POLL_MS = 4000;
/** Stop polling ~5 min in — a dead provider balance would otherwise spin forever. */
const GRADING_POLL_MAX_MS = 5 * 60_000;

function QuizView({
  classId,
  quizFocusAt,
  onContinue,
}: {
  classId: number;
  /** Set when the learner switches to the quiz tab; null = never opened. */
  quizFocusAt: MutableRefObject<number | null>;
  onContinue: () => void;
}) {
  const queryClient = useQueryClient();
  // The just-submitted result seeds the page instantly; the server query is
  // the durable truth (remounts, graded updates, in-flight polling).
  const [submittedResult, setSubmittedResult] = useState<QuizSubmitResult | null>(null);
  useEffect(() => setSubmittedResult(null), [classId]);

  const { data, isLoading } = useQuery({
    queryKey: ['quizByClassId', classId],
    queryFn: () => rpc.quiz.get({ classId }),
    refetchOnMount: 'always',
  });

  // Submit lock + results on re-entry: a non-null server result means the
  // quiz tab renders results, never the stepper. Polls only while open-ended
  // grading is in flight, at a sane interval, capped in time.
  const resultQuery = useQuery({
    queryKey: ['quizResult', classId],
    queryFn: () => rpc.quiz.result({ classId }),
    refetchInterval: (query) => {
      const result = query.state.data?.result;
      if (!result?.perQuestion.some((p) => p.isCorrect === null)) return false;
      return Date.now() - query.state.dataUpdatedAt > GRADING_POLL_MAX_MS ? false : GRADING_POLL_MS;
    },
  });

  const submit = useMutation({
    mutationFn: () => {
      const submitted = useQuizStore
        .getState()
        .answers.filter((a): a is { questionId: number; answer: string } => a.answer !== null)
        .map(({ questionId, answer }) => ({ questionId, answer }));
      const startedAt = quizFocusAt.current;
      // One-page quiz: no per-question timers exist, so the total quiz time
      // is distributed evenly — the per-answer sum reconstructs the total.
      const perAnswerMs =
        startedAt !== null && submitted.length > 0
          ? Math.round((Date.now() - startedAt) / submitted.length)
          : undefined;
      return rpc.quiz.submit({
        classId,
        answers: submitted.map((a) => ({ ...a, timeSpentMs: perAnswerMs })),
      });
    },
    onSuccess: (result) => {
      setSubmittedResult(result);
      // Seed the query cache: results render now and the grading poll takes over.
      queryClient.setQueryData(['quizResult', classId], { result });
    },
  });
    // Quiz-completion analytics: one event per fully-graded submit.
    useEffect(() => {
      const result = resultQuery.data?.result;
      if (!result || quizFocusAt.current === null) return;
      if (result.perQuestion.some((p) => p.isCorrect === null)) return;
      const startedAt = quizFocusAt.current;
      quizFocusAt.current = null;
      void track('quiz_completed', {
        class_id: classId,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        correct: result.perQuestion.filter((p) => p.isCorrect === true).length,
        total: result.perQuestion.length,
      });
    }, [resultQuery.data, classId, quizFocusAt]);

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
      result={submittedResult ?? resultQuery.data?.result ?? null}
      submitPending={submit.isPending}
      onSubmit={() => submit.mutate()}
      onContinue={onContinue}
    />
  );
}
