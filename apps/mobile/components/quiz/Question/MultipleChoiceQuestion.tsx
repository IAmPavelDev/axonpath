import { FC, useContext } from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet } from 'react-native';
import { Checkbox } from '@atomics/checkbox';
import { QuestionContext, QuestionContextType } from '@components/quiz/Quiz';
import { useQuizStore } from '@/store/quiz.store';

export const MultipleChoiceQuestion: FC<{ options: string[]; questionId: number }> = (props) => {
  const { answers, setAnswer } = useQuizStore();
  const answer = answers.find(({ questionId }) => questionId === props.questionId)?.answer ?? null;
  const toggleCheckedState = (key: string) => {
    console.log(props.questionId);
    setAnswer(props.questionId, answer === key ? null : key);
  };

  return (
    <View>
      {props.options.map((option, index) => (
        <Pressable style={styles.option} key={index} onPress={() => toggleCheckedState(option)}>
          <Checkbox
            checked={!!answer && answer === option}
            onCheckedChange={() => toggleCheckedState(option)}
          />
          <Text>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
});
