import { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuizStore } from '@/store/quiz.store';

export const TrueFalseQuestion: FC<{ questionId: number }> = ({ questionId }) => {
  const { answers, setAnswer } = useQuizStore();
  const answer = answers.find(({ questionId: id }) => id === questionId)?.answer ?? null;

  return (
    <View style={styles.container}>
      {['True', 'False'].map((option) => (
        <Pressable
          key={option}
          style={[styles.option, answer === option && styles.selected]}
          onPress={() => setAnswer(questionId, answer === option ? null : option)}>
          <Text>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 12,
  },
  option: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  selected: {
    borderColor: '#4f46e5',
    backgroundColor: '#eef2ff',
  },
});
