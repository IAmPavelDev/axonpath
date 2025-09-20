import { Question } from "@/prisma/generated/client";

export type SubmitQuizAnswersInputDto = {
  answers: {
    questionId: number;
    answer: string;
  }[];
};

export type SubmitQuizAnswersOutputDto = {
  questions: Pick<Question, 'id' | 'type' | 'text' | 'choices'>[];
};