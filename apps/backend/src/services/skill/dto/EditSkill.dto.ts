export interface EditSkillInputDto {
  id: number;
  topic?: string;
  description?: string;
}

export interface EditSkillOutputDto {
  id: number;
  status: string;
}
