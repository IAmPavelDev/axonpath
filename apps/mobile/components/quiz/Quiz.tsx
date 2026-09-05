import { createContext, FC, useLayoutEffect } from 'react';
import { View, Text } from 'react-native';
import { Question as QuestionDataType } from '@/types/quiz';
import { Question } from './Question/index';
import { Button } from '../atomics/button';
import { StyleSheet } from 'react-native';
import { useQuizStore } from '@/store/quiz.store';

export type QuestionContextType = {
  answers: { questionId: number; answer: string | null }[];
  setAnswer: (questionId: number, answer: string | null) => void;
};
export const QuestionContext = createContext<QuestionContextType>({
  answers: [],
  setAnswer: () => {},
});

export const Quiz: FC<{ questions: QuestionDataType[]; classId: number }> = (props) => {
  const { setQuestions, questions } = useQuizStore();
  const classQuestionsList = questions[props.classId] ?? [];
  useLayoutEffect(() => {
    setQuestions(props.classId, props.questions);
  }, [props.classId]);

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
          onPress={() => {
            console.log('submit');
          }}>
          <Text style={styles.submit}>Submit</Text>
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
