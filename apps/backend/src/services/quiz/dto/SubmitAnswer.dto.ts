import { QuestionDto } from "../question.mapper";

export type SubmitQuizAnswersInputDto = {
  answers: {
    questionId: number;
    answer: string;
  }[];
};

export type SubmitQuizAnswersOutputDto = {
  questions: QuestionDto[];
};
