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
};
