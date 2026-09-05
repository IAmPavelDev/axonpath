import { useLocalSearchParams } from 'expo-router';
import rpc from '@/utils/rpc';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/atomics/spinner';
import { ClassList } from '@/components/class/ClassList';

export default function Route() {
  const { skillId } = useLocalSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['classList'],
    queryFn: () => rpc.class.list({ skillId: Number(skillId) }),
  });

  return isLoading || !data ? <Spinner /> : <ClassList data={data} />;
}
