import { NewClassOptions } from '@components/skill/NewClassOptions';
import { Text } from '@atomics/text';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

export default function Route() {
  const { skillId } = useLocalSearchParams<{ skillId: string }>();
  const id = Number(skillId);

  if (!Number.isFinite(id)) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text variant="muted">Invalid skill id.</Text>
      </View>
    );
  }

  return <NewClassOptions skillId={id} />;
}
