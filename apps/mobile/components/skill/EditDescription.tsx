import { Button } from '@atomics/button';
import { PulseDot } from '@atomics/pulse-dot';
import { ScreenHeader } from '@components/screen-header';
import { Skeleton } from '@atomics/skeleton';
import { Text } from '@atomics/text';
import { Textarea } from '@atomics/textarea';
import rpc from '@/utils/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FC, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const EditSkillDescription: FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const skillId = Number(id);

  const { data } = useQuery({
    queryKey: ['skillData', skillId],
    queryFn: () => rpc.skill.get({ id: skillId }),
    // Poll only while the AI description is still missing.
    refetchInterval: (query) => (query.state.data?.description ? false : 2000),
    retry: true,
    enabled: Number.isFinite(skillId),
  });

  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  // The poll delivers the AI-generated description after mount; adopt it
  // until the user starts typing, then their text wins.
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
      router.replace(`/skill/${skillId}`);
    },
  });

  const submit = () => {
    if (!isPending && Number.isFinite(skillId)) {
      mutate({ description: description.trim() });
    }
  };

  const isGenerating = !touched && !data?.description;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader onBack={() => router.back()} />

      <View className="flex-1 justify-center gap-6 px-6" style={{ marginBottom: '8%' }}>
        <View className="gap-3">
          <Text variant="label">Step 2 of 2</Text>
          <Text className="font-serif-medium text-[28px] leading-[34px] tracking-tight">
            Add context
          </Text>
          <Text variant="muted">
            Optional. Describe your goal or level — it shapes your lessons.
          </Text>
        </View>

        {isGenerating ? (
          <View className="gap-4 rounded-lg border-hairline border-border p-4">
            <View className="flex-row items-center gap-2.5">
              <PulseDot />
              <Text className="text-sm text-muted-foreground">Writing description…</Text>
            </View>
            <View className="gap-2.5">
              <Skeleton className="h-4 w-full rounded-sm" />
              <Skeleton className="h-4 w-5/6 rounded-sm" />
              <Skeleton className="h-4 w-2/3 rounded-sm" />
            </View>
          </View>
        ) : (
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
        )}
        {error && <Text variant="muted" className="text-destructive">{error.message}</Text>}
      </View>

      <View className="px-6" style={{ paddingBottom: 24 + insets.bottom }}>
        <Button size="lg" className="w-full" onPress={submit} disabled={isPending || !Number.isFinite(skillId)}>
          <Text>{isPending ? 'Saving…' : isGenerating ? 'Keep writing…' : 'Save and continue'}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
};
