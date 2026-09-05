import { Button } from '@/components/atomics/button';
import { Input } from '@/components/atomics/input';
import { Spinner } from '@/components/atomics/spinner';
import { Text } from '@/components/atomics/text';
import { ClassListItem } from '@/components/class/ClassList';
import { useDimensions } from '@/hooks/useDimensions';
import rpc from '@/utils/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FC, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

export const SkillDetail: FC<{ skillId: number }> = ({ skillId }) => {
  const { screenHeight } = useDimensions();
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');

  const {
    data: skill,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['skill', skillId],
    queryFn: () => rpc.skill.get({ id: skillId }),
  });

  const { data: classes } = useQuery({
    queryKey: ['classList', skillId],
    queryFn: () => rpc.class.list({ skillId }),
  });

  useEffect(() => {
    if (skill) {
      setTopic(skill.topic);
      setDescription(skill.description);
    }
  }, [skill]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['skill', skillId] });
    await queryClient.invalidateQueries({ queryKey: ['skillList'] });
  };

  const { mutate: saveTopic, isPending: topicPending, error: topicError } = useMutation({
    mutationFn: (value: string) => rpc.skill.edit({ id: skillId, topic: value.trim() }),
    onSuccess: invalidate,
  });

  const {
    mutate: saveDescription,
    isPending: descriptionPending,
    error: descriptionError,
  } = useMutation({
    mutationFn: (value: string) =>
      rpc.skill.edit({ id: skillId, description: value.trim() }),
    onSuccess: invalidate,
  });

  if (isLoading || !skill) {
    return <Spinner />;
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

  const isSaving = topicPending || descriptionPending;

  return (
    <FlatList
      data={classes ?? []}
      style={{
        flex: 1,
        paddingHorizontal: 16,
        marginBottom: screenHeight / 4,
      }}
      keyExtractor={(classData) => classData.id.toString()}
      ListHeaderComponent={
        <View style={{ gap: 12, paddingVertical: 16 }}>
          {error && (
            <Text variant="muted" className="text-destructive">
              {error.message}
            </Text>
          )}

          <Text variant="h2">Topic</Text>
          <Input
            value={topic}
            onChangeText={setTopic}
            placeholder="Topic you are learning"
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={submitTopic}
          />
          {topicError && (
            <Text variant="muted" className="text-destructive">
              {topicError.message}
            </Text>
          )}

          <Text variant="h2">Description</Text>
          <Input
            value={description}
            onChangeText={setDescription}
            placeholder="Short description"
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={submitDescription}
          />
          {descriptionError && (
            <Text variant="muted" className="text-destructive">
              {descriptionError.message}
            </Text>
          )}

          <Button
            onPress={() => {
              submitTopic();
              submitDescription();
            }}
            disabled={isSaving}>
            <Text>Save changes</Text>
          </Button>

          <Text variant="h2">Lessons</Text>
        </View>
      }
      renderItem={({ item: classData }) => <ClassListItem classData={classData} />}
      ListEmptyComponent={
        <Text variant="muted">No lessons yet</Text>
      }
    />
  );
};
