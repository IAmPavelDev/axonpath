export interface GetSkillByIdInputDto {
  id: number;
}

export interface GetSkillByIdOutputDto {
  id: number;
  topic: string;
  description: string;
  status: string;
}
