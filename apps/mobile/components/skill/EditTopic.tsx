import { Button } from '@atomics/button';
import { Input } from '@atomics/input';
import { ScreenHeader } from '@components/screen-header';
import { Text } from '@atomics/text';
import rpc from '@/utils/rpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FC, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const EditSkillTopic: FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState('');

  const { mutate, isPending, error } = useMutation({
    mutationFn: (input: { topic: string }) => rpc.skill.create(input),
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: ['skillList'] });
      router.replace(`/skill/description?id=${skill.id}`);
    },
  });

  const trimmedTopic = topic.trim();
  const isDisabled = isPending || trimmedTopic.length === 0;

  const submit = () => {
    if (!isDisabled) {
      mutate({ topic: trimmedTopic });
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader onBack={() => router.back()} />

      <View className="flex-1 justify-center gap-8 px-6" style={{ marginBottom: '20%' }}>
        <View className="gap-3">
          <Text variant="label">Step 1 of 2</Text>
          <Text className="font-sans-medium text-[28px] leading-[34px] tracking-tight">
            What do you want to learn?
          </Text>
        </View>
        <Input
          value={topic}
          onChangeText={setTopic}
          placeholder="Type a topic…"
          className="h-14 rounded-lg text-lg"
          editable={!isPending}
          returnKeyType="done"
          onSubmitEditing={submit}
          autoFocus
        />
        {error && <Text variant="muted" className="text-destructive">{error.message}</Text>}
      </View>

      <View className="px-6 pb-6" style={{ paddingBottom: 24 + insets.bottom }}>
        <Button size="lg" className="w-full" onPress={submit} disabled={isDisabled}>
          <Text>{isPending ? 'Creating…' : 'Continue'}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
};
