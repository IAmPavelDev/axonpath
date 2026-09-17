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
  findById(id: number): Promise<Pick<Class, "id" | "title" | "contentMd"> | null>;
};
