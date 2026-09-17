import { Button } from '@atomics/button';
import { Input } from '@atomics/input';
import { Textarea } from '@atomics/textarea';
import { Spinner } from '@atomics/spinner';
import { Text } from '@atomics/text';
import { ClassListItem } from '@components/class/ClassList';
import rpc from '@/utils/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FC, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

export const SkillDetail: FC<{ skillId: number }> = ({ skillId }) => {
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

  const {
    mutate: saveTopic,
    isPending: topicPending,
    error: topicError,
  } = useMutation({
    mutationFn: (value: string) => rpc.skill.edit({ id: skillId, topic: value.trim() }),
    onSuccess: invalidate,
  });

  const {
    mutate: saveDescription,
    isPending: descriptionPending,
    error: descriptionError,
  } = useMutation({
    mutationFn: (value: string) => rpc.skill.edit({ id: skillId, description: value.trim() }),
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
    <View style={{ flex: 1, gap: 12, padding: 16 }}>
      {error && (
        <Text variant="muted" className="text-destructive">
          {error.message}
        </Text>
      )}

      <Text variant="h4">Topic</Text>
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

      <Text variant="h4">Description</Text>
      <Textarea
        value={description}
        onChangeText={setDescription}
        placeholder="Short description"
        editable={!isSaving}
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

      <Text variant="h4">Lessons</Text>
      <FlatList
        data={classes ?? []}
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 8 }}
        keyExtractor={(classData) => classData.id.toString()}
        renderItem={({ item: classData }) => <ClassListItem classData={classData} />}
        ListEmptyComponent={<Text variant="muted">No lessons yet</Text>}
      />
    </View>
  );
};
