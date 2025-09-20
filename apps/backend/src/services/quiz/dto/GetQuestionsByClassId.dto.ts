import { QuestionType } from "@/prisma/generated";

export type GetQuestionsByClassIdInputDto = {
  classId: number;
};

export type GetQuestionsByClassIdOutputDto = {
  questions: QuestionDto[];
};

type QuestionDto = {
  id: number;
  type: QuestionType;
  text: string;
  choices: string[];
};