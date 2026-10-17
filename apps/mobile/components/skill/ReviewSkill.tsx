import { Button } from '@atomics/button';
import { Input } from '@atomics/input';
import { PulseDot } from '@atomics/pulse-dot';
import { ScreenHeader } from '@components/screen-header';
import { Skeleton } from '@atomics/skeleton';
import { KeyboardAvoidingView } from '@atomics/keyboard-avoiding-view';
import { Text } from '@atomics/text';
import { Textarea } from '@atomics/textarea';
import rpc from '@/utils/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FC, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const POLL_INTERVAL_MS = 1000;

export const ReviewSkill: FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const skillId = Number(id);

  // The backend drafts the title + description from the prompt; poll until
  // they land. Polling ends with the screen on redirect — the observer
  // unmounts with it.
  const { data: skill, refetch } = useQuery({
    queryKey: ['skillData', skillId],
    queryFn: () => rpc.skill.get({ id: skillId }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    enabled: Number.isFinite(skillId),
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [descriptionTouched, setDescriptionTouched] = useState(false);

  // Adopt the AI draft field-by-field until the user edits that field;
  // their text always wins afterwards.
  useEffect(() => {
    if (!skill) return;
    if (!titleTouched) setTitle(skill.topic);
    if (!descriptionTouched) setDescription(skill.description);
  }, [skill, titleTouched, descriptionTouched]);

  const { mutate: accept, isPending, error } = useMutation({
    mutationFn: (input: { topic: string; description: string }) =>
      rpc.skill.edit({ id: skillId, topic: input.topic, description: input.description }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['skillList'] });
      // The edit call arms the first-lesson generation server-side; the
      // detail screen shows it as the generating skeleton row.
      router.replace(`/skill/${skillId}`);
    },
  });

  const { mutate: retry, isPending: retryPending } = useMutation({
    mutationFn: () => rpc.skill.retry({ id: skillId }),
    onSuccess: () => refetch(),
  });

  const isFailed = skill?.status === 'FAILED';
  const isPreparing =
    Number.isFinite(skillId) && !isFailed && !titleTouched && !skill?.description;

  const submit = () => {
    const trimmedTitle = title.trim();
    if (!isPending && Number.isFinite(skillId) && trimmedTitle.length > 0) {
      accept({ topic: trimmedTitle, description: description.trim() });
    }
  };

  if (!Number.isFinite(skillId)) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text variant="muted">Invalid skill id.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <ScreenHeader onBack={() => router.back()} />

      {isPreparing ? (
        <View className="flex-1 justify-center gap-10 px-6" style={{ marginBottom: '22%' }}>
          <View className="gap-3">
            <Text variant="label">Step 2 of 2</Text>
            <Text className="font-sans-medium text-[28px] leading-[34px] tracking-tight">
              Writing your title and description
            </Text>
          </View>
          <View className="gap-4 rounded-lg border-hairline border-border p-4">
            <View className="flex-row items-center gap-2.5">
              <PulseDot />
              <Text className="text-sm text-muted-foreground">
                Drafting from your description…
              </Text>
            </View>
            <View className="gap-2.5">
              <Skeleton className="h-6 w-2/3 rounded-sm" />
              <Skeleton className="h-4 w-full rounded-sm" />
              <Skeleton className="h-4 w-5/6 rounded-sm" />
            </View>
          </View>
        </View>
      ) : (
        <View className="flex-1 justify-center gap-6 px-6" style={{ marginBottom: '8%' }}>
          <View className="gap-3">
            <Text variant="label">Step 2 of 2</Text>
            <Text className="font-sans-medium text-[28px] leading-[34px] tracking-tight">
              Review your skill
            </Text>
            <Text variant="muted">
              Drafted from your description. Edit anything — your first lesson
              is generated after you start.
            </Text>
          </View>
          <View className="gap-2">
            <Text variant="label">Title</Text>
            <Input
              value={title}
              onChangeText={(value) => {
                setTitleTouched(true);
                setTitle(value);
              }}
              placeholder="Skill title"
              className="h-14 rounded-lg text-lg"
              editable={!isPending}
            />
          </View>
          <View className="gap-2">
            <Text variant="label">Description</Text>
            <Textarea
              value={description}
              onChangeText={(value) => {
                setDescriptionTouched(true);
                setDescription(value);
              }}
              placeholder="What this skill covers"
              editable={!isPending}
              className="rounded-lg"
            />
          </View>
          {isFailed && (
            <View className="gap-2">
              <Text variant="body" className="text-destructive">
                Drafting your title and description failed. Retrying usually
                fixes it.
              </Text>
              <Button size="sm" variant="outline" onPress={() => retry()} disabled={retryPending}>
                <Text>{retryPending ? 'Retrying…' : 'Try again'}</Text>
              </Button>
            </View>
          )}
        </View>
      )}

      {error && (
        <Text variant="muted" className="px-6 pb-3 text-destructive">
          {error.message}
        </Text>
      )}

      <View className="px-6" style={{ paddingBottom: 24 + insets.bottom }}>
        <Button
          size="lg"
          className="w-full"
          onPress={submit}
          disabled={isPending || isPreparing || isFailed || title.trim().length === 0}>
          <Text>{isPending ? 'Starting…' : 'Start learning'}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
};
