import { Button } from '@atomics/button';
import { Textarea } from '@atomics/textarea';
import { Text } from '@atomics/text';
import rpc from '@/utils/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FC, useEffect, useState } from 'react';
import { View } from 'react-native';

export const EditSkillDescription: FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const skillId = Number(id);

  const { data } = useQuery({
    queryKey: ['skillData', skillId],
    queryFn: () => rpc.skill.get({ id: skillId }),
    refetchInterval: 2000,
    retry: true,
  })

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

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 16,
        gap: 16,
      }}>
      <Text variant="h2">Describe your skill</Text>
      <Textarea
        value={description}
        onChangeText={(value) => {
          setTouched(true);
          setDescription(value);
        }}
        placeholder="Short description (optional)"
        editable={!isPending}
        autoFocus
      />
      {!touched && !data?.description && (
        <Text variant="muted">Generating description…</Text>
      )}
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
