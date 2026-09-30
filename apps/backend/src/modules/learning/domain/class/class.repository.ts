import type { NewQuestion } from "../quiz/question";
import type { Class, ClassListItem } from "./class";

export type ClassRepository = {
  /**
   * Persist a class and its quiz questions in one transaction — a crash can
   * never strand a class without questions. Vectors stay best-effort AFTER
   * the relational commit (Qdrant cannot join a relational transaction).
   */
  createWithQuestions(
    cls: {
      skillId: number;
      index: number;
      title: string;
      contentMd: string;
      aiModel?: string;
    },
    questions: Array<Omit<NewQuestion, "skillId" | "classId">>,
  ): Promise<Pick<Class, "id">>;
  listBySkill(skillId: number, userId: number): Promise<ClassListItem[]>;
  /**
   * Progress read: every lesson of a skill in curriculum order with its
   * question count. Unlike listBySkill (client lesson list: newest first,
   * per-user stats), this is user-independent and ordered by index.
   */
  listBySkillByIndex(
    skillId: number,
  ): Promise<Array<{ id: number; index: number; title: string; questionCount: number }>>;
  /** Latest lesson by (skillId, index); null before init has created class 0. */
  findTopBySkill(skillId: number): Promise<{ id: number; index: number; title: string } | null>;
  findById(id: number): Promise<Pick<Class, "id" | "skillId" | "title" | "contentMd"> | null>;
  /** Titles + curriculum indexes for a set of class ids (answer-memory snippets). */
  listByIds(ids: number[]): Promise<Array<{ id: number; index: number; title: string }>>;
};
