import { QuestionDto } from "../question.mapper";

export type GetQuestionsByClassIdInputDto = {
  classId: number;
};

export type GetQuestionsByClassIdOutputDto = {
  questions: QuestionDto[];
};
