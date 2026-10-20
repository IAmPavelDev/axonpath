import type { SkillStatus } from "@/prisma/generated";

export type SkillListItem = {
  id: number;
  topic: string;
  description: string;
  status: string;
  userId: number;
  requestId: number | null;
  createdAt: Date;
  updatedAt: Date;
  lessonCount: number;
  completedLessons: number;
  learnedPoints: number;
  lastActivityAt: Date | null;
};

export type SkillCoreRow = {
  id: number;
  topic: string;
  /** The learner's original freeform brief the title/description came from. */
  prompt: string;
  description: string;
  status: string;
  userId: number;
};

export type SkillRepository = {
  create(input: {
    userId: number;
    prompt: string;
    topic: string;
    status: SkillStatus;
  }): Promise<{ id: number; status: string }>;
  update(
    id: number,
    patch: {
      topic?: string;
      description?: string;
      status?: SkillStatus;
    },
  ): Promise<{
    id: number;
    topic: string;
    description: string;
    status: string;
  }>;
  /**
   * Hard delete. Postgres FKs cascade classes, questions, answers, progress,
   * events, vectors, and recommendations; the FK-free NextClassJob marker is
   * removed explicitly in the same transaction.
   */
  delete(id: number): Promise<void>;
  findById(id: number): Promise<SkillCoreRow | null>;
  /** Archived skills leave the list unless explicitly included (deep links still reach them). */
  listByUser(
    userId: number,
    options?: { includeArchived?: boolean },
  ): Promise<SkillListItem[]>;
  /** Skills in one status — the cron's reconciliation sweep enumerates ACTIVE. */
  listByStatus(status: SkillStatus): Promise<SkillListItem[]>;
  /**
   * Atomically claim stuck stage-1 generations: GENERATING skills with zero
   * classes untouched since `olderThan` (the in-process job was lost — the
   * serverless API freezes setImmediate work; covers both a lost create
   * init and a lost/failed first-lesson arm). Claiming refreshes updatedAt,
   * which doubles as the lease: concurrent sweepers never claim the same
   * skill, and a run in flight keeps it claimed. The sweeper branches on
   * description: empty = metadata (title/description) never landed —
   * re-run stage 1; non-empty = the lesson pipeline died — re-run stage 2.
   */
  claimStaleInit(
    olderThan: Date,
  ): Promise<
    Array<{ id: number; userId: number; prompt: string; description: string }>
  >;
  /**
   * Claim lesson-less ACTIVE skills whose review was abandoned (the learner
   * created the skill, the draft landed, but skill.edit never accepted it).
   * Heals as implicit acceptance: flips the skill GENERATING (refreshing
   * the updatedAt lease) so stage 2 regenerates from the stored draft, and
   * a dead provider cannot loop the requeue.
   */
  claimStaleFirstLesson(olderThan: Date): Promise<Array<{ id: number; userId: number }>>;
  /**
   * Recovery net for a GENERATING skill whose generation pipeline died after
   * persisting a class but before settling (crash between class-create and
   * settle — e.g. an expired Prisma transaction on the API). Legal GENERATING
   * states always own either zero classes (init, claimStaleInit's case) or a
   * live NextClassJob marker (the adaptive loop), so a stale GENERATING skill
   * with a class and no marker is abandoned. Settles it ACTIVE — the lesson
   * exists and the loop re-arms on the next submit.
   */
  settleStaleGenerating(olderThan: Date): Promise<number[]>;
};
