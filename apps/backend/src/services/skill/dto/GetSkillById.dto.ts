export interface GetSkillByIdInputDto {
  id: number;
  userId: number;
}

export interface GetSkillByIdOutputDto {
  id: number;
  topic: string;
  description: string;
  status: string;
}