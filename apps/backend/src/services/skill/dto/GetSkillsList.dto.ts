import { Skill } from "@/prisma/generated/client";

export interface GetSkillsListInputDto {
  userId: number;
}

export interface GetSkillsListOutputDto {
  skills: Skill[];
}