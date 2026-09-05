export interface EditSkillInputDto {
  id: number;
  userId: number;
  topic?: string;
  description?: string;
}

export interface EditSkillOutputDto {
  id: number;
  status: string;
}
