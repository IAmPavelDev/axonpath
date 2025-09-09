export interface CreateSkillInputDto {
  topic: string;
  userId: number;
}

export interface CreateSkillOutputDto {
  id: number;
  status: string;
}
