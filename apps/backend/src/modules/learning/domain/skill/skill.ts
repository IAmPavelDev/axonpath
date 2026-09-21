import type { SkillStatus } from "@/prisma/generated";

/**
 * Skill aggregate — plain data. Invariants live in pure functions alongside
 * the type; persistence happens through SkillRepository.
 */
export type Skill = {
  id: number;
  userId: number;
  topic: string;
  description: string;
  status: SkillStatus;
};

export type SkillListItem = {
  id: number;
  topic: string;
  description: string;
  status: SkillStatus;
  userId: number;
  lambda: number;
  requestId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Allowed SkillStatus transitions. GENERATING is the AI-initialization phase;
 * a skill becomes ACTIVE once its first class exists, FAILED when generation
 * fails (a retry re-enters GENERATING). DRAFT is legacy — backfilled away.
 * COMPLETED/ARCHIVED are terminal except ARCHIVED.
 */
export const SKILL_TRANSITIONS: Record<SkillStatus, SkillStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  GENERATING: ["ACTIVE", "FAILED"],
  FAILED: ["GENERATING"],
  ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const canTransition = (from: SkillStatus, to: SkillStatus): boolean =>
  SKILL_TRANSITIONS[from].includes(to);

export type SkillError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "InvalidSkillTransition"; from: SkillStatus; to: SkillStatus; detail?: string };
