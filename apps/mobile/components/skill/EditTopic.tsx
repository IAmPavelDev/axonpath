import { Button } from '@atomics/button';
import { Input } from '@atomics/input';
import { KeyboardAvoidingView } from '@atomics/keyboard-avoiding-view';
import { ScreenHeader } from '@components/screen-header';
import { Text } from '@atomics/text';
import { Pressable, View } from 'react-native';
import { GraduationCap, Map } from 'lucide-react-native';
import rpc from '@/utils/rpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FC, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SkillMode = 'AUTOMATIC' | 'MANUAL';

const MODES: Array<{ value: SkillMode; title: string; hint: string; icon: typeof Map }> = [
  {
    value: 'AUTOMATIC',
    title: 'Automatic',
    hint: 'Every finished lesson flows straight into the next one.',
    icon: GraduationCap,
  },
  {
    value: 'MANUAL',
    title: 'Manual',
    hint: 'You pick the direction for each next lesson from suggestions.',
    icon: Map,
  },
];

export const EditSkillTopic: FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<SkillMode>('AUTOMATIC');

  const { mutate, isPending, error } = useMutation({
    mutationFn: (input: { topic: string; mode: SkillMode }) => rpc.skill.create(input),
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: ['skillList'] });
      router.replace(`/skill/description?id=${skill.id}&mode=${mode}`);
    },
  });

  const trimmedTopic = topic.trim();
  const isDisabled = isPending || trimmedTopic.length === 0;

  const submit = () => {
    if (!isDisabled) {
      mutate({ topic: trimmedTopic, mode });
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <ScreenHeader onBack={() => router.back()} />

      <View className="flex-1 justify-center gap-8 px-6" style={{ marginBottom: '12%' }}>
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
        <View className="gap-2">
          {MODES.map(({ value, title, hint, icon: IconComponent }) => {
            const selected = mode === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                disabled={isPending}
                onPress={() => setMode(value)}
                className={`flex-row items-center gap-3 rounded-lg border-hairline p-3.5 ${
                  selected ? 'border-foreground/40 bg-accent' : 'border-border bg-transparent'
                }`}>
                <IconComponent
                  size={20}
                  strokeWidth={2}
                  className={selected ? 'text-foreground' : 'text-muted-foreground'}
                />
                <View className="flex-1 gap-0.5">
                  <Text className={`text-[15px] ${selected ? 'font-sans-medium' : ''}`}>
                    {title}
                  </Text>
                  <Text variant="muted" className="text-[13px]">
                    {hint}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
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
