import { Text } from '@/components/ui/text';
import rpc from '@/utils/rpc';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';
import { Markdown } from 'react-native-markdown-x';

export default function Route() {
  const { classId } = useLocalSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['classById'],
    queryFn: () => rpc.class.get({ id: Number(classId) }),
  });

  return (
    <ScrollView style={{ paddingHorizontal: 16, marginVertical: 16 }}>
      <Markdown>{data?.contentMd}</Markdown>
    </ScrollView>
  );
}
