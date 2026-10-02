import { Button } from '@atomics/button';
import { Spinner } from '@atomics/spinner';
import { ScreenHeader } from '@components/screen-header';
import { Text } from '@atomics/text';
import { Icon } from '@atomics/icon';
import { schema } from '@axon/api-contract';
import type { z } from 'zod';
import rpc from '@/utils/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronDown, Plus } from 'lucide-react-native';
import { FC, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ClassOptionsSnapshot = z.infer<typeof schema.skill.GetClassOptionsOutput>;
type ClassOption = z.infer<typeof schema.skill.SkillClassOption>;

/** A stale PENDING older than this means the generator died with a process —
 * offer the retry instead of an endless spinner. */
const STALE_PENDING_MS = 3 * 60 * 1000;

/** Folded preview: three clipped lines with a fading overlay. */
const FOLDED_LINES = 3;

type Draft = {
  /** Negative ids mark locally-added custom drafts. */
  key: string;
  text: string;
};

const FoldedOption: FC<{
  option: ClassOption;
  index: number;
  onUnfold: () => void;
}> = ({ option, index, onUnfold }) => (
  <Pressable
    accessibilityRole="button"
    onPress={onUnfold}
    className="rounded-lg border-hairline border-border bg-background p-3">
    <View>
      <Text
        className="text-[15px] leading-5 text-foreground"
        numberOfLines={FOLDED_LINES}>
        {option.text}
      </Text>
      {/* Fade the clipped tail so the fold reads as "more below". */}
      <View className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-background/70" />
    </View>
    <View className="mt-2 flex-row items-center justify-between">
      <Text variant="muted" className="text-[13px]">
        {index === 0 ? 'Best pick' : `Option ${index + 1}`}
      </Text>
      <View className="flex-row items-center gap-1">
        <Text className="text-[13px] text-muted-foreground">Show more</Text>
        <Icon as={ChevronDown} size={16} className="text-muted-foreground" strokeWidth={2} />
      </View>
    </View>
  </Pressable>
);

/**
 * The MANUAL-mode picker: three ranked, editable candidate directions for the
 * next lesson (plus a custom one). Folded cards preview the text; unfolding
 * pins one direction full-screen with the choose action always visible.
 */
export const NewClassOptions: FC<{ skillId: number }> = ({ skillId }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const {
    data: snapshot,
    refetch,
  } = useQuery({
    queryKey: ['classOptions', skillId],
    queryFn: () => rpc.skill.classOptions({ id: skillId }),
    // The options job is one AI request; poll quickly while it runs.
    refetchInterval: (query) =>
      query.state.data?.state === 'PENDING' ? 2000 : false,
    refetchIntervalInBackground: false,
  });

  const refresh = useMutation({
    mutationFn: () => rpc.skill.refreshClassOptions({ id: skillId }),
    onSuccess: () => refetch(),
  });

  const createClass = useMutation({
    mutationFn: (target: string) => rpc.skill.createClass({ id: skillId, target }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['skill', skillId] });
      await queryClient.invalidateQueries({ queryKey: ['classList', skillId] });
      await queryClient.invalidateQueries({ queryKey: ['classOptions', skillId] });
      // The skill detail's GENERATING row takes over from here.
      router.back();
    },
  });

  // NONE means nothing is armed (resume after pause, mode flip while
  // paused) — arm it once so the picker never dead-ends.
  useEffect(() => {
    if (snapshot?.state === 'NONE' && !refresh.isPending) {
      refresh.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.state]);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [customCount, setCustomCount] = useState(0);

  const stalePending =
    snapshot?.state === 'PENDING' &&
    snapshot.optionsStateAt !== null &&
    Date.now() - new Date(snapshot.optionsStateAt).getTime() > STALE_PENDING_MS;

  const addCustom = () => {
    const key = `custom-${customCount + 1}`;
    setCustomCount((count) => count + 1);
    setDrafts((current) => [...current, { key, text: '' }]);
    setExpandedKey(key);
  };

  const draftFor = (key: string): Draft | undefined =>
    drafts.find((draft) => draft.key === key);

  const setDraftText = (key: string, text: string) =>
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? { ...draft, text } : draft)),
    );

  const options = useMemo(() => snapshot?.options ?? [], [snapshot]);

  const expandedDraft = expandedKey ? draftFor(expandedKey) : undefined;
  const expandedOption =
    expandedKey && !expandedDraft
      ? options.find((option) => option.id.toString() === expandedKey)
      : undefined;
  const expandedText = expandedDraft?.text ?? expandedOption?.text ?? '';

  const choose = () => {
    const target = expandedText.trim();
    if (target.length > 0 && !createClass.isPending) {
      createClass.mutate(target);
    }
  };

  const state = snapshot?.state;

  if (state === 'PENDING' && !stalePending) {
    return (
      <View className="flex-1">
        <ScreenHeader onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Spinner />
          <Text variant="muted">Generating options…</Text>
          <Text variant="muted" className="text-center text-[13px]">
            Axon is proposing three directions for your next lesson.
          </Text>
        </View>
      </View>
    );
  }

  if (state === 'FAILED' || (state === 'PENDING' && stalePending)) {
    return (
      <View className="flex-1">
        <ScreenHeader onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Text variant="muted" className="text-center">
            The suggestions took too long to prepare.
          </Text>
          <Button variant="outline" onPress={() => refresh.mutate()} disabled={refresh.isPending}>
            <Text>{refresh.isPending ? 'Retrying…' : 'Try again'}</Text>
          </Button>
        </View>
      </View>
    );
  }

  if (state === 'READY' && expandedKey !== null) {
    // Unfolded: the direction is pinned on screen — scroll the text, edit it,
    // fold it back, or commit it. The choose action never scrolls away.
    return (
      <KeyboardAvoidingView className="flex-1 bg-background">
        <View className="h-14 flex-row items-center justify-between px-3">
          <Button variant="ghost" size="sm" onPress={() => setExpandedKey(null)}>
            <View className="flex-row items-center gap-1">
              <Icon as={ChevronDown} size={16} className="text-foreground" strokeWidth={2} />
              <Text className="text-sm">Fold</Text>
            </View>
          </Button>
          <Text variant="label">Learning direction</Text>
          <View className="w-16" />
        </View>
        <View className="flex-1 px-4">
          <TextInput
            value={expandedText}
            onChangeText={(text) => {
              if (expandedDraft) {
                setDraftText(expandedDraft.key, text);
              } else {
                setDrafts((current) => [
                  ...current,
                  { key: expandedKey, text },
                ]);
              }
            }}
            multiline
            scrollEnabled
            textAlignVertical="top"
            autoFocus={!expandedDraft}
            className="flex-1 rounded-lg border-hairline border-border p-3 text-[15px] leading-5 text-foreground"
            editable={!createClass.isPending}
          />
        </View>
        {createClass.error && (
          <Text variant="muted" className="px-6 pt-2 text-destructive">
            {createClass.error.message}
          </Text>
        )}
        <View className="px-6 pb-4 pt-3" style={{ paddingBottom: 16 + insets.bottom }}>
          <Button
            size="lg"
            className="w-full"
            onPress={choose}
            disabled={expandedText.trim().length === 0 || createClass.isPending}>
            <Text>{createClass.isPending ? 'Preparing your lesson…' : 'Choose path'}</Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View className="flex-1">
      <ScreenHeader onBack={() => router.back()} />
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-3 px-6 pb-8">
        <View className="gap-2 pb-1">
          <Text className="font-sans-medium text-[24px] leading-[30px] tracking-tight">
            Where to next?
          </Text>
          <Text variant="muted">
            Pick a direction for your next lesson — unfold to edit it, or write
            your own.
          </Text>
        </View>

        {state === 'READY' &&
          options.map((option, index) => (
            <FoldedOption
              key={option.id}
              option={option}
              index={index}
              onUnfold={() => setExpandedKey(option.id.toString())}
            />
          ))}

        {drafts.map((draft, index) => (
          <Pressable
            key={draft.key}
            accessibilityRole="button"
            onPress={() => setExpandedKey(draft.key)}
            className="rounded-lg border-hairline border-border bg-background p-3">
            <View>
              <Text className="text-[15px] leading-5 text-foreground" numberOfLines={FOLDED_LINES}>
                {draft.text.length > 0 ? draft.text : 'Your own direction…'}
              </Text>
              <View className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-background/70" />
            </View>
            <View className="mt-2 flex-row items-center justify-between">
              <Text variant="muted" className="text-[13px]">
                Custom {index + 1}
              </Text>
              <View className="flex-row items-center gap-1">
                <Text className="text-[13px] text-muted-foreground">Show more</Text>
                <Icon as={ChevronDown} size={16} className="text-muted-foreground" strokeWidth={2} />
              </View>
            </View>
          </Pressable>
        ))}

        <Button variant="outline" className="mt-2" onPress={addCustom}>
          <View className="flex-row items-center gap-2">
            <Icon as={Plus} size={16} className="text-foreground" strokeWidth={2} />
            <Text>Add your own</Text>
          </View>
        </Button>
      </ScrollView>
    </View>
  );
};
