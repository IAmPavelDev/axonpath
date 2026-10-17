import { Button } from '@atomics/button';
import { KeyboardAvoidingView } from '@atomics/keyboard-avoiding-view';
import { ScreenHeader } from '@components/screen-header';
import { Text } from '@atomics/text';
import { Textarea } from '@atomics/textarea';
import { View } from 'react-native';
import rpc from '@/utils/rpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FC, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const CreateSkill: FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState('');

  const { mutate, isPending, error } = useMutation({
    mutationFn: (input: { prompt: string }) => rpc.skill.create(input),
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: ['skillList'] });
      router.replace(`/skill/description?id=${skill.id}`);
    },
  });

  const trimmedPrompt = prompt.trim();
  const isDisabled = isPending || trimmedPrompt.length === 0;

  const submit = () => {
    if (!isDisabled) {
      mutate({ prompt: trimmedPrompt });
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <ScreenHeader onBack={() => router.back()} />

      <View className="flex-1 justify-center gap-6 px-6" style={{ marginBottom: '12%' }}>
        <View className="gap-3">
          <Text variant="label">Step 1 of 2</Text>
          <Text className="font-sans-medium text-[28px] leading-[34px] tracking-tight">
            What do you want to learn?
          </Text>
          <Text variant="muted">
            Write a short explanation of what you want to learn — your goal,
            level, or why it matters. Axon drafts a title and description from
            it; you review both before your first lesson is generated.
          </Text>
        </View>
        <Textarea
          value={prompt}
          onChangeText={setPrompt}
          placeholder="e.g. I want to learn SQL joins for work — I know basic SELECTs, we use Postgres, and I keep writing the same queries by hand…"
          editable={!isPending}
          className="rounded-lg"
          autoFocus
        />
        {error && <Text variant="muted" className="text-destructive">{error.message}</Text>}
      </View>

      <View className="px-6 pb-6" style={{ paddingBottom: 24 + insets.bottom }}>
        <Button size="lg" className="w-full" onPress={submit} disabled={isDisabled}>
          <Text>{isPending ? 'Creating…' : 'Create skill'}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
};
