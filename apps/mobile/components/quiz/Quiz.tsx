import { createContext, FC, useState, useLayoutEffect } from 'react';
import { View, Text } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import rpc from '@/utils/rpc';
import { Question as QuestionDataType, QuizSubmitResult } from '@/types/quiz';
import { Question } from './Question/index';
import { Button } from '@atomics/button';
import { StyleSheet } from 'react-native';
import { useQuizStore } from '@/store/quiz.store';
import { QuizResult } from './QuizResult';

export type QuestionContextType = {
  answers: { questionId: number; answer: string | null }[];
  setAnswer: (questionId: number, answer: string | null) => void;
};
export const QuestionContext = createContext<QuestionContextType>({
  answers: [],
  setAnswer: () => {},
});

export const Quiz: FC<{ questions: QuestionDataType[]; classId: number }> = (props) => {
  const router = useRouter();
  const { setQuestions, questions } = useQuizStore();
  const storeAnswers = useQuizStore((state) => state.answers);
  const classQuestionsList = questions[props.classId] ?? [];
  const [result, setResult] = useState<QuizSubmitResult | null>(null);

  useLayoutEffect(() => {
    setQuestions(props.classId, props.questions);
  }, [props.classId]);

  const submit = useMutation({
    mutationFn: () => {
      const answers = storeAnswers
        .filter((a): a is { questionId: number; answer: string } => a.answer !== null)
        .map(({ questionId, answer }) => ({ questionId, answer }));
      return rpc.quiz.submit({ classId: props.classId, answers });
    },
    onSuccess: setResult,
  });

  if (result) {
    return (
      <QuizResult
        result={result}
        questions={classQuestionsList}
        onContinue={() => router.back()}
      />
    );
  }

  return (
    <View>
      <View>
        {classQuestionsList.map((question) => {
          return <Question key={question.id} question={question} />;
        })}
      </View>
      <View>
        <Button
          style={styles.container}
          disabled={submit.isPending || classQuestionsList.length === 0}
          onPress={() => submit.mutate()}>
          <Text style={styles.submit}>{submit.isPending ? 'Submitting…' : 'Submit'}</Text>
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  submit: {
    color: 'white',
    fontWeight: 'bold',
  },
  container: {
    width: '50%',
    alignSelf: 'center',
  },
});
