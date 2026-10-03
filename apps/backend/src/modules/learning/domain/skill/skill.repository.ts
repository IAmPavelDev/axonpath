import type {
  NextClassOptionsState,
  SkillMode,
  SkillStatus,
} from "@/prisma/generated";

export type SkillListItem = {
  id: number;
  topic: string;
  description: string;
  status: string;
  mode: SkillMode;
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
  description: string;
  status: string;
  mode: SkillMode;
  optionsState: NextClassOptionsState;
  optionsStateAt: Date | null;
  userId: number;
};

export type SkillRepository = {
  create(input: {
    userId: number;
    topic: string;
    status: SkillStatus;
    mode: SkillMode;
  }): Promise<{ id: number; status: string }>;
  update(
    id: number,
    patch: {
      topic?: string;
      description?: string;
      status?: SkillStatus;
      mode?: SkillMode;
      optionsState?: NextClassOptionsState;
      /** Timestamp accompanying an optionsState change (null clears it). */
      optionsStateAt?: Date | null;
    },
  ): Promise<{
    id: number;
    topic: string;
    description: string;
    status: string;
    mode: SkillMode;
    optionsState: NextClassOptionsState;
    optionsStateAt: Date | null;
  }>;
  findById(id: number): Promise<SkillCoreRow | null>;
  /** Archived skills leave the list unless explicitly included (deep links still reach them). */
  listByUser(
    userId: number,
    options?: { includeArchived?: boolean },
  ): Promise<SkillListItem[]>;
  /** Skills in one status — the cron's reconciliation sweep enumerates ACTIVE. */
  listByStatus(status: SkillStatus): Promise<SkillListItem[]>;
  /**
   * Atomically claim stuck init generations: GENERATING skills with zero
   * classes untouched since `olderThan` (create-skill's in-process job was
   * lost — the serverless API freezes setImmediate work). Claiming refreshes
   * updatedAt, which doubles as the lease: concurrent sweepers never claim
   * the same skill, and a run in flight keeps it claimed.
   */
  claimStaleInit(
    olderThan: Date,
  ): Promise<Array<{ id: number; userId: number; topic: string }>>;
  /**
   * MANUAL skills whose candidate-options job was lost: optionsState still
   * PENDING past `olderThan`. Plain read — re-enqueueing while a run is in
   * flight is benign (the job's writes are last-wins), and every terminal
   * outcome (READY/FAILED) drops the skill out of the query.
   */
  listStalePendingOptions(
    olderThan: Date,
  ): Promise<Array<{ id: number; userId: number }>>;
};
