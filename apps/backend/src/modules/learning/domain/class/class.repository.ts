import type { NewQuestion } from "../quiz/question";
import type { Class, ClassListItem } from "./class";

export type ClassRepository = {
  /**
   * Persist a class row. Questions are written separately by the quiz job
   * (CLASS_QUIZ_JOB) — the broker guarantees at-least-once delivery, and the
   * generation's failure path marks the skill FAILED so a crash can never
   * strand a permanently question-less class. Vectors stay best-effort AFTER
   * the relational commit (Qdrant cannot join a relational transaction).
   */
  create(cls: {
    skillId: number;
    index: number;
    title: string;
    contentMd: string;
    baseLanguage: string | null;
    aiModel?: string;
  }): Promise<Pick<Class, "id">>;
  /** Quiz-job completion side: persist the generated questions for a class. */
  addQuestions(
    classId: number,
    skillId: number,
    questions: Array<Omit<NewQuestion, "skillId" | "classId">>,
  ): Promise<void>;
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
  findById(
    id: number,
  ): Promise<
    Pick<Class, "id" | "skillId" | "index" | "title" | "contentMd" | "baseLanguage"> | null
  >;
  /** Titles + curriculum indexes for a set of class ids (answer-memory snippets). */
  listByIds(ids: number[]): Promise<Array<{ id: number; index: number; title: string }>>;
  /**
   * Current question counts for the given classes — the completion side of
   * stats derivations (a class counts completed when distinct answered
   * questions cover its count). Only classes that have questions appear.
   */
  findQuestionCountsByClassIds(
    classIds: number[],
  ): Promise<Array<{ classId: number; questionCount: number }>>;
};
