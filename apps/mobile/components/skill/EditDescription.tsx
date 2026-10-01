import { Button } from '@atomics/button';
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

export const EditSkillDescription: FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const skillId = Number(id);

  const { data } = useQuery({
    queryKey: ['skillData', skillId],
    queryFn: () => rpc.skill.get({ id: skillId }),
    enabled: Number.isFinite(skillId),
    retry: true,
    // Smart polling: the next request is scheduled POLL_INTERVAL_MS after
    // the previous response landed, never while one is in flight. Polling
    // ends the moment a description exists — and dies with the screen on
    // redirect, since the observer unmounts.
    refetchInterval: (query) => {
      if (query.state.data?.description) {
        return false;
      }
      const sinceResponse = Date.now() - (query.state.dataUpdatedAt ?? 0);
      return Math.max(100, POLL_INTERVAL_MS - sinceResponse);
    },
  });

  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  // The poll delivers the AI-generated description; adopt it until the
  // user starts typing, then their text wins.
  useEffect(() => {
    if (!touched && data?.description) {
      setDescription(data.description);
    }
  }, [data?.description, touched]);

  const { mutate, isPending, error } = useMutation({
    mutationFn: (input: { description: string }) =>
      rpc.skill.edit({ id: skillId, description: input.description }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['skillList'] });
      // Redirect unmounts this screen; its polling observer dies with it.
      router.replace(`/skill/${skillId}`);
    },
  });

  const submit = () => {
    if (!isPending && Number.isFinite(skillId)) {
      mutate({ description: description.trim() });
    }
  };

  // Full-screen preparation while the AI writes; the textarea only appears
  // once a description exists (freshly prefilled).
  const isPreparing = !touched && !data?.description;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <ScreenHeader onBack={() => router.back()} />

      {isPreparing ? (
        <View className="flex-1 justify-center gap-10 px-6" style={{ marginBottom: '22%' }}>
          <View className="gap-3">
            <Text variant="label">Step 2 of 2</Text>
            <Text className="font-sans-medium text-[28px] leading-[34px] tracking-tight">
              Preparing basic context for you
            </Text>
          </View>
          <View className="gap-4 rounded-lg border-hairline border-border p-4">
            <View className="flex-row items-center gap-2.5">
              <PulseDot />
              <Text className="text-sm text-muted-foreground">Reading up on your topic…</Text>
            </View>
            <View className="gap-2.5">
              <Skeleton className="h-4 w-full rounded-sm" />
              <Skeleton className="h-4 w-5/6 rounded-sm" />
              <Skeleton className="h-4 w-2/3 rounded-sm" />
            </View>
          </View>
        </View>
      ) : (
        <View className="flex-1 justify-center gap-6 px-6" style={{ marginBottom: '8%' }}>
          <View className="gap-3">
            <Text variant="label">Step 2 of 2</Text>
            <Text className="font-sans-medium text-[28px] leading-[34px] tracking-tight">
              Add context
            </Text>
            <Text variant="muted">
              Optional. Describe your goal or level — it shapes your lessons.
            </Text>
          </View>
          <Textarea
            value={description}
            onChangeText={(value) => {
              setTouched(true);
              setDescription(value);
            }}
            placeholder="Short description (optional)"
            editable={!isPending}
            className="rounded-lg"
          />
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
          disabled={isPending || isPreparing || !Number.isFinite(skillId)}>
          <Text>{isPending ? 'Saving…' : 'Save and continue'}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
};
