import { QuestionType } from "@/prisma/generated/client";
import { AiModelType } from "@/types/AiModels";

export interface CreateQuestionInputDto {
  skillId: number;
  classId: number;
  type: QuestionType;
  text: string;
  choices: string[];
  answerKey: string;
  aiModel: AiModelType;
}

export interface CreateQuestionOutputDto {
  questionId: number;
}