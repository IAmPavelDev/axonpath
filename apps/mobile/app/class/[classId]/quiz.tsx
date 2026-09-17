import { useClassData } from './_layout';
import rpc from '@/utils/rpc';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@atomics/skeleton';
import { View } from 'react-native';
import { Quiz } from '@components/quiz/Quiz';

export default function Route() {
  const classData = useClassData();
  const { data, isLoading } = useQuery({
    queryKey: ['quizByClassId'],
    queryFn: () => rpc.quiz.get({ classId: Number(classData.id) }),
  });

  if (isLoading || !data) {
    return (
      <View className="flex-1 px-6 pt-10">
        <Skeleton className="mb-6 h-4 w-24 rounded-sm" />
        <Skeleton className="mb-3 h-7 w-full rounded-md" />
        <Skeleton className="mb-8 h-7 w-2/3 rounded-md" />
        <View className="gap-3">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </View>
      </View>
    );
  }

  return <Quiz questions={data} classId={classData.id} />;
}
