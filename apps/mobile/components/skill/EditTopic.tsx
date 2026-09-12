import { Button } from '@atomics/button';
import { Input } from '@atomics/input';
import { Text } from '@atomics/text';
import { useDimensions } from '@hooks/useDimensions';
import rpc from '@/utils/rpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FC, useState } from 'react';
import { View } from 'react-native';

export const EditSkillTopic: FC = () => {
  const { screenHeight } = useDimensions();
  const router = useRouter();
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
    <View
      style={{
        height: screenHeight,
        paddingHorizontal: 16,
        justifyContent: 'center',
        gap: 16,
      }}>
      <Text variant="h2">Create new skill</Text>
      <Input
        value={topic}
        onChangeText={setTopic}
        placeholder="Topic you want to learn"
        editable={!isPending}
        returnKeyType="done"
        onSubmitEditing={submit}
        autoFocus
      />
      {error && (
        <Text variant="muted" className="text-destructive">
          {error.message}
        </Text>
      )}
      <Button onPress={submit} disabled={isDisabled}>
        <Text>Create</Text>
      </Button>
    </View>
  );
};
