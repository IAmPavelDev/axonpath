import { Button } from '@atomics/button';
import { Input } from '@atomics/input';
import { ScreenHeader } from '@components/screen-header';
import { Skeleton } from '@atomics/skeleton';
import { Text } from '@atomics/text';
import { Textarea } from '@atomics/textarea';
import { ClassListItem } from '@components/class/ClassList';
import { ProgressPanel } from '@components/skill/ProgressPanel';
import { StatusControls } from '@components/skill/StatusControls';
import type { SettableSkillStatus } from '@/types/skill';
import rpc from '@/utils/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

export const SkillDetail: FC<{ skillId: number }> = ({ skillId }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');

  const {
    data: skill,
    isLoading,
    error,
    refetch,
    isRefetching,
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
    mutate: setSkillStatus,
    isPending: statusPending,
  } = useMutation({
    mutationFn: (status: SettableSkillStatus) =>
      rpc.skill.updateStatus({ id: skillId, status }),
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
    return (
      <View className="flex-1 px-6 pt-10">
        <Skeleton className="mb-8 h-8 w-2/3 rounded-md" />
        <View className="gap-2.5">
          <Skeleton className="h-4 w-full rounded-sm" />
          <Skeleton className="h-4 w-11/12 rounded-sm" />
          <Skeleton className="h-4 w-3/5 rounded-sm" />
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

  return (
    <View className="flex-1">
      <FlatList
        data={sortedClasses}
        keyExtractor={(classData) => classData.id.toString()}
        renderItem={({ item: classData }) => <ClassListItem classData={classData} />}
        ItemSeparatorComponent={() => <View className="border-hairline border-border" />}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); refetchClasses(); }} tintColor="hsl(0 0% 45%)" />
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
                  <Text variant="body" className="text-muted-foreground">
                    {skill.description}
                  </Text>
                )}
                <Text variant="meta">
                  {sortedClasses.length} {sortedClasses.length === 1 ? 'lesson' : 'lessons'}
                </Text>
                {skill.status === 'GENERATING' && (
                  <Text variant="body" className="text-muted-foreground">
                    Preparing your next lesson…
                  </Text>
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
                <StatusControls status={skill.status} disabled={statusPending} onSetStatus={setSkillStatus} />
              </View>
            )}
            {progress ? <ProgressPanel progress={progress} /> : null}
            <View className="border-hairline border-border px-6 pb-2 pt-1">
              <Text variant="label">Lessons</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="px-6 py-8">
            <Text variant="muted">No lessons yet.</Text>
          </View>
        }
      />
    </View>
  );
};
