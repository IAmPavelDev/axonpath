import type { Class, ClassListItem } from "./class";

export type ClassRepository = {
  create(input: {
    skillId: number;
    index: number;
    title: string;
    contentMd: string;
    aiModel?: string;
  }): Promise<Pick<Class, "id">>;
  listBySkill(skillId: number, userId: number): Promise<ClassListItem[]>;
  /** Latest lesson by (skillId, index); null before init has created class 0. */
  findTopBySkill(skillId: number): Promise<{ id: number; index: number; title: string } | null>;
  findById(id: number): Promise<Pick<Class, "id" | "skillId" | "title" | "contentMd"> | null>;
};
