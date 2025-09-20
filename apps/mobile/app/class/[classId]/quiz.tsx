import { useClassData } from './_layout';
import rpc from '@/utils/rpc';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/spinner';
import { ScrollView } from 'react-native';
import { Quiz } from '@/components/quiz/Quiz';

export default function Route() {
  const classData = useClassData();
  const { data, isLoading, error } = useQuery({
    queryKey: ['quizByClassId'],
    queryFn: () => rpc.quiz.get({ classId: Number(classData.id) }),
  });

  if (isLoading || !data) {
    return <Spinner />;
  }

  return (
    <ScrollView>
      <Quiz questions={data} classId={classData.id} />
    </ScrollView>
  );
}
