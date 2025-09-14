export interface CreateAnswerInputDto {
  questionId: number;
  userId: number;
  content: string;
  score: number;
  isCorrect: boolean;
  timeSpentMs: number;
  device: string;
}

export interface CreateAnswerOutputDto {
  answerId: number;
}