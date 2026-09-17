import { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@atomics/button';
import type { Question, QuizSubmitResult } from '@/types/quiz';

export const QuizResult: FC<{
  result: QuizSubmitResult;
  questions: Question[];
  onContinue: () => void;
}> = ({ result, questions, onContinue }) => {
  const textById = new Map(questions.map((q) => [q.id, q.text]));

  return (
    <View style={styles.container}>
      <Text style={styles.score}>
        You scored {result.score} / {result.total}
      </Text>
      {result.perQuestion.map((entry) => (
        <View key={entry.questionId} style={styles.row}>
          <Text style={entry.isCorrect ? styles.correct : styles.incorrect}>
            {entry.isCorrect ? '✓' : '✗'}
          </Text>
          <View style={styles.body}>
            <Text numberOfLines={2}>{textById.get(entry.questionId) ?? `#${entry.questionId}`}</Text>
            {!entry.isCorrect && entry.correctAnswer !== null && (
              <Text style={styles.answer}>Correct answer: {entry.correctAnswer}</Text>
            )}
          </View>
        </View>
      ))}
      <Button style={styles.continue} onPress={onContinue}>
        <Text style={styles.continueText}>Continue</Text>
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  score: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  correct: {
    color: '#16a34a',
    fontSize: 18,
  },
  incorrect: {
    color: '#dc2626',
    fontSize: 18,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  answer: {
    color: '#6b7280',
  },
  continue: {
    width: '50%',
    alignSelf: 'center',
    marginTop: 12,
  },
  continueText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
