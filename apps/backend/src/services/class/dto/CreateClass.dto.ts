import { AiModelType } from "@/types/AiModels";

export interface CreateClassInputDto {
  skillId: number;
  index: number;
  title: string;
  contentMd: string;
  aiModel: AiModelType;
}

export interface CreateClassOutputDto {
  classId: number;
}