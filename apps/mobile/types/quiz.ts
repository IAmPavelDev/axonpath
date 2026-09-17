import type { SubmitQuizAnswersOutput } from '@axon/api-contract';
import rpc from '@/utils/rpc';

export enum QuestionType {
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  TRUE_FALSE = 'TRUE_FALSE',
  OPEN_ENDED = 'OPEN_ENDED',
}

export type Question = Awaited<ReturnType<typeof rpc.quiz.get>>[0];

export type QuizSubmitResult = SubmitQuizAnswersOutput;