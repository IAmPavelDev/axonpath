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
 * Allowed SkillStatus transitions. GENERATING is the AI-at-work phase: the
 * initial build (create → ACTIVE/FAILED) and the adaptive loop's next-class
 * composition (submit-quiz flips ACTIVE → GENERATING; the pipeline settles
 * it back to ACTIVE). FAILED means init never produced a class — a retry
 * re-enters GENERATING. DRAFT is legacy — backfilled away. COMPLETED and
 * ARCHIVED are terminal except ARCHIVED.
 */
export const SKILL_TRANSITIONS: Record<SkillStatus, SkillStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  GENERATING: ["ACTIVE", "FAILED"],
  FAILED: ["GENERATING"],
  ACTIVE: ["GENERATING", "PAUSED", "COMPLETED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const canTransition = (from: SkillStatus, to: SkillStatus): boolean =>
  SKILL_TRANSITIONS[from].includes(to);

export type SkillError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "InvalidSkillTransition"; from: SkillStatus; to: SkillStatus; detail?: string };
