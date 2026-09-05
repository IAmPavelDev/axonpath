import { Button } from '@/components/atomics/button';
import { Input } from '@/components/atomics/input';
import { Text } from '@/components/atomics/text';
import { useDimensions } from '@/hooks/useDimensions';
import rpc from '@/utils/rpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FC, useState } from 'react';
import { View } from 'react-native';

export const EditSkillDescription: FC = () => {
  const { screenHeight } = useDimensions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const skillId = Number(id);
  const [description, setDescription] = useState('');

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

  return (
    <View
      style={{
        height: screenHeight,
        paddingHorizontal: 16,
        justifyContent: 'center',
        gap: 16,
      }}>
      <Text variant="h2">Describe your skill</Text>
      <Input
        value={description}
        onChangeText={setDescription}
        placeholder="Short description (optional)"
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
      <Button onPress={submit} disabled={isPending || !Number.isFinite(skillId)}>
        <Text>Save</Text>
      </Button>
    </View>
  );
};
