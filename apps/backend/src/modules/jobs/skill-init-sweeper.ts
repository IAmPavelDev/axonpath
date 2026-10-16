import { logger } from "@/lib/logger";

import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { SKILL_INIT_JOB } from "@/modules/learning/application/commands/create-skill";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import { makeMinuteSweeper, type MinuteSweeper } from "./minute-sweeper";

/** A claimed skill's lease: updatedAt is refreshed on claim, so a fresh
 * attempt cannot be double-claimed for this long (in-flight init keeps it). */
export const INIT_STALE_MS = 120_000;

export type SkillInitSweeper = MinuteSweeper;

/**
 * Recovery net for skills stuck in their GENERATING phase:
 *
 * 1. Lost skill-init (create-skill / retry-skill): the description + lesson-0
 *    job has no durable row, so on the serverless API — where the in-process
 *    setImmediate queue is frozen the moment a request returns — a lost job
 *    leaves the skill GENERATING with zero classes forever. Each tick claims
 *    such skills (status GENERATING, no classes, untouched past
 *    INIT_STALE_MS) and re-enqueues the job. Self-terminating: the init
 *    pipeline settles the skill ACTIVE on success or FAILED on failure, and a
 *    dead provider therefore cannot loop this requeue.
 *
 * 2. Abandoned generation (init or the adaptive loop dying AFTER persisting a
 *    class but before settling — a crash between class-create and settle,
 *    e.g. an expired transaction). A legal GENERATING phase always owns
 *    either zero classes (case 1) or a live NextClassJob marker, so a stale
 *    GENERATING skill with a class and no marker is dead. Settled ACTIVE: the
 *    lesson exists, and the adaptive loop re-arms on the next submit.
 */
export const makeSkillInitSweeper = ({
  skillRepo,
  jobs,
}: {
  skillRepo: Pick<SkillRepository, "claimStaleInit" | "settleStaleGenerating">;
  jobs: JobQueuePort;
}): SkillInitSweeper =>
  makeMinuteSweeper(async () => {
    try {
      const claimed = await skillRepo.claimStaleInit(
        new Date(Date.now() - INIT_STALE_MS),
      );
      for (const skill of claimed) {
        jobs.enqueue(SKILL_INIT_JOB, {
          skillId: skill.id,
          userId: skill.userId,
          topic: skill.topic,
        });
      }
      if (claimed.length > 0) {
        logger.warn({ requeued: claimed.map((skill) => skill.id) }, "Requeued lost skill-init jobs");
      }
      const settled = await skillRepo.settleStaleGenerating(
        new Date(Date.now() - INIT_STALE_MS),
      );
      if (settled.length > 0) {
        logger.warn(
          { settled },
          "Settled abandoned GENERATING skills ACTIVE (pipeline died after class-create)",
        );
      }
    } catch (err) {
      logger.error({ err }, "Skill-init sweep failed");
    }
  });
