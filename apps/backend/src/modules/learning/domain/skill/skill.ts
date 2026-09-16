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
 * Allowed SkillStatus transitions. DRAFT is the AI-initialization phase;
 * a skill becomes ACTIVE once its first class is generated (future wiring),
 * COMPLETED/ARCHIVED are terminal except ARCHIVED.
 */
export const SKILL_TRANSITIONS: Record<SkillStatus, SkillStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
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
