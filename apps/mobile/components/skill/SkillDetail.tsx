import { Button } from '@atomics/button';
import { Input } from '@atomics/input';
import { KeyboardAvoidingView } from '@atomics/keyboard-avoiding-view';
import { SegmentedControl } from '@atomics/segmented-control';
import { Icon } from '@atomics/icon';
import { ScreenHeader } from '@components/screen-header';
import { Skeleton } from '@atomics/skeleton';
import { Text } from '@atomics/text';
import { Textarea } from '@atomics/textarea';
import { ClassListItem } from '@components/class/ClassList';
import { Class } from '@/types/class';
import rpc from '@/utils/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronDown, Plus } from 'lucide-react-native';
import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

/** One list row while the next lesson generates: ClassListItem's exact
 * geometry — two title lines (17px/24px), meta line (13px/18px), chevron —
 * inert. */
const ClassItemSkeleton = () => (
  <View className="flex-row items-center gap-4 bg-background px-6 py-4">
    <View className="flex-1">
      <Skeleton className="h-6 w-11/12 rounded-sm" />
      <Skeleton className="h-6 w-2/3 rounded-sm" />
      <Skeleton className="mt-1 h-[18px] w-2/5 rounded-sm" />
    </View>
    <Skeleton className="size-4 rounded-sm" />
  </View>
);

type ClassListRow =
  | { kind: 'generating' }
  | { kind: 'class'; classData: Class };

export const SkillDetail: FC<{ skillId: number }> = ({ skillId }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  const {
    data: skill,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['skill', skillId],
    queryFn: () => rpc.skill.get({ id: skillId }),
    // Poll while this skill page is open; paused when the app is backgrounded.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const { data: classes, refetch: refetchClasses } = useQuery({
    queryKey: ['classList', skillId],
    queryFn: () => rpc.class.list({ skillId }),
    // Same cadence: the generated lesson surfaces here the moment the
    // pipeline finishes, instead of only on the next manual refresh.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const { data: progress } = useQuery({
    queryKey: ['skillProgress', skillId],
    queryFn: () => rpc.skill.progress({ id: skillId }),
    // Graded open-ended scores surface through progress; refetch on mount
    // (returning from a quiz) instead of waiting for the next poll tick.
    refetchOnMount: 'always',
    // Progress moves with submits and newly generated lessons; same cadence
    // as the sibling queries so all three stay consistent on screen.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  // Only a user-initiated pull may drive the native refresh spinner;
  // background polls refresh silently.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), refetchClasses()]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (skill) {
      setTopic(skill.topic);
      setDescription(skill.description);
    }
  }, [skill]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['skill', skillId] });
    await queryClient.invalidateQueries({ queryKey: ['skillProgress', skillId] });
    await queryClient.invalidateQueries({ queryKey: ['skillList'] });
  };

  const {
    mutate: saveTopic,
    isPending: topicPending,
    error: topicError,
  } = useMutation({
    mutationFn: (value: string) => rpc.skill.edit({ id: skillId, topic: value.trim() }),
    onSuccess: invalidate,
  });

  const {
    mutate: saveDescription,
    isPending: descriptionPending,
    error: descriptionError,
  } = useMutation({
    mutationFn: (value: string) => rpc.skill.edit({ id: skillId, description: value.trim() }),
    onSuccess: invalidate,
  });

  const {
    mutate: retryGeneration,
    isPending: retryPending,
  } = useMutation({
    mutationFn: () => rpc.skill.retry({ id: skillId }),
    onSuccess: invalidate,
  });

  const {
    mutate: setSkillMode,
    isPending: modePending,
  } = useMutation({
    mutationFn: (mode: 'AUTOMATIC' | 'MANUAL') => rpc.skill.setMode({ id: skillId, mode }),
    onSuccess: invalidate,
  });

  // Newest first, oldest last.
  const sortedClasses = useMemo(
    () =>
      [...(classes ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [classes]
  );

  // Learning success per lesson: correct/answered from skill.progress,
  // merged into the lesson rows by id.
  const accuracyByClassId = useMemo(
    () => new Map(progress?.classes.map((cls) => [cls.classId, cls.accuracy])),
    [progress]
  );

  const isSaving = topicPending || descriptionPending;
  const wasSaving = useRef(false);

  useEffect(() => {
    if (isSaving) {
      wasSaving.current = true;
      return;
    }
    if (wasSaving.current) {
      wasSaving.current = false;
      if (!topicError && !descriptionError) {
        setEditing(false);
      }
    }
  }, [isSaving, topicError, descriptionError]);

  if (isLoading || !skill) {
    // Mirrors the loaded layout block for block: header row (h-14, px-3),
    // topic (28px/34px), folded description line (29px), LESSONS label bar —
    // so nothing shifts when real content replaces the placeholder.
    return (
      <View className="flex-1">
        <View className="h-14 flex-row items-center px-3">
          <Skeleton className="size-10 rounded-full" />
        </View>
        <View className="gap-3 px-6 pb-7 pt-1">
          <Skeleton className="h-[34px] w-2/3 rounded-sm" />
          <Skeleton className="h-[29px] w-full rounded-sm" />
        </View>
        <View className="border-hairline border-border px-6 pb-2 pt-1">
          <Skeleton className="h-4 w-20 rounded-sm" />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text variant="muted">{error.message}</Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  const submitTopic = () => {
    if (!topicPending && topic.trim().length > 0) {
      saveTopic(topic);
    }
  };

  const submitDescription = () => {
    if (!descriptionPending) {
      saveDescription(description);
    }
  };

  const classRows: ClassListRow[] = sortedClasses.map((classData) => ({ kind: 'class', classData }));
  // While a lesson generates, a skeleton row holds its place at the top of
  // the list (newest first) and is replaced by the real row on arrival.
  const listData: ClassListRow[] =
    skill.status === 'GENERATING' ? [{ kind: 'generating' }, ...classRows] : classRows;

  return (
    <KeyboardAvoidingView className="flex-1">
      <FlatList
        data={listData}
        keyExtractor={(row) =>
          row.kind === 'generating' ? 'generating' : row.classData.id.toString()
        }
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: row }) =>
          row.kind === 'generating' ? (
            <ClassItemSkeleton />
          ) : (
            <ClassListItem
              classData={row.classData}
              accuracy={accuracyByClassId.get(row.classData.id) ?? null}
            />
          )
        }
        ItemSeparatorComponent={() => <View className="border-hairline border-border" />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="hsl(0 0% 45%)" />
        }
        ListHeaderComponent={
          <View>
            <ScreenHeader
              onBack={() => router.back()}
              right={
                editing ? undefined : (
                  <Button variant="ghost" size="sm" onPress={() => setEditing(true)}>
                    <Text className="text-sm">Edit</Text>
                  </Button>
                )
              }
            />
            {editing ? (
              <View className="gap-5 px-6 pb-6 pt-1">
                <View className="gap-2">
                  <Text variant="label">Topic</Text>
                  <Input
                    value={topic}
                    onChangeText={setTopic}
                    placeholder="Topic you are learning"
                    editable={!isSaving}
                    returnKeyType="done"
                    onSubmitEditing={submitTopic}
                  />
                </View>
                <View className="gap-2">
                  <Text variant="label">Description</Text>
                  <Textarea
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Short description"
                    editable={!isSaving}
                  />
                </View>
                {topicError && (
                  <Text variant="muted" className="text-destructive">
                    {topicError.message}
                  </Text>
                )}
                {descriptionError && (
                  <Text variant="muted" className="text-destructive">
                    {descriptionError.message}
                  </Text>
                )}
                <View className="flex-row gap-3">
                  <Button
                    variant="ghost"
                    className="flex-1"
                    disabled={isSaving}
                    onPress={() => {
                      setTopic(skill.topic);
                      setDescription(skill.description);
                      setEditing(false);
                    }}>
                    <Text>Cancel</Text>
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={isSaving}
                    onPress={() => {
                      submitTopic();
                      submitDescription();
                    }}>
                    <Text>{isSaving ? 'Saving…' : 'Save changes'}</Text>
                  </Button>
                </View>
              </View>
            ) : (
              <View className="gap-3 px-6 pb-7 pt-1">
                <Text className="font-sans-medium text-[28px] leading-[34px] tracking-tight">
                  {skill.topic}
                </Text>
                {skill.description.length > 0 && (
                  <Pressable
                    className="flex-row items-start gap-1"
                    onPress={() => setDescriptionOpen((open) => !open)}
                  >
                    <Text
                      variant="body"
                      className="flex-1 text-muted-foreground"
                      numberOfLines={descriptionOpen ? undefined : 1}
                    >
                      {skill.description}
                    </Text>
                    <Icon
                      as={ChevronDown}
                      size={16}
                      className="mt-1 shrink-0 text-muted-foreground"
                      strokeWidth={2}
                      style={{
                        transform: [{ rotate: descriptionOpen ? '180deg' : '0deg' }],
                      }}
                    />
                  </Pressable>
                )}
                {skill.status === 'FAILED' && (
                  <View className="gap-2 pt-1">
                    <Text variant="body" className="text-destructive">
                      The first lesson failed to generate. Retrying usually fixes it.
                    </Text>
                    <Button size="sm" onPress={() => retryGeneration()} disabled={retryPending}>
                      <Text>{retryPending ? 'Retrying…' : 'Try again'}</Text>
                    </Button>
                  </View>
                )}
                {(skill.status === 'ACTIVE' || skill.status === 'PAUSED') && (
                  <View className="gap-2 pt-1">
                    <Text variant="label">Lesson flow</Text>
                    <SegmentedControl
                      options={[
                        { value: 'AUTOMATIC', label: 'Automatic' },
                        { value: 'MANUAL', label: 'Manual' },
                      ]}
                      value={skill.mode}
                      onChange={(value) => {
                        if (value !== skill.mode) {
                          setSkillMode(value);
                        }
                      }}
                    />
                    {skill.mode === 'MANUAL' && skill.status === 'ACTIVE' && (
                      <Button
                        className="mt-1"
                        disabled={modePending}
                        onPress={() => router.push(`/skill/${skillId}/new-class`)}>
                        <View className="flex-row items-center gap-2">
                          <Icon as={Plus} size={16} strokeWidth={2} />
                          <Text>
                            {sortedClasses.length === 0
                              ? 'Create your first class'
                              : 'Add next class'}
                          </Text>
                        </View>
                      </Button>
                    )}
                  </View>
                )}
              </View>
            )}
            <View className="border-hairline border-border px-6 pb-2 pt-1">
              <Text variant="label">Lessons</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="px-6 py-8">
            <Text variant="muted">
              {skill.mode === 'MANUAL'
                ? 'No lessons yet — pick a direction for your first one.'
                : 'No lessons yet.'}
            </Text>
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
};
