import { FC } from 'react';
import { View, Text } from 'react-native';
import { QuestionType, Question as QuestionDataType } from '@/types/quiz';
import { StyleSheet } from 'react-native';
import { MultipleChoiceQuestion } from './MultipleChoiceQuestion';
import { TrueFalseQuestion } from './TrueFalseQuestion';
import { OpenEndedQuestion } from './OpenEndedQuestion';

export const Question: FC<{
  question: QuestionDataType;
}> = ({ question }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.question}>{question.text}</Text>
      {question.type === QuestionType.MULTIPLE_CHOICE && (
        <MultipleChoiceQuestion options={question.choices} questionId={question.id} />
      )}
      {question.type === QuestionType.TRUE_FALSE && <TrueFalseQuestion />}
      {question.type === QuestionType.OPEN_ENDED && <OpenEndedQuestion />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  question: {
    fontSize: 20,
    fontWeight: 'bold',
  }
});
