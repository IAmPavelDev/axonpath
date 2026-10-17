import { logger } from "@/lib/logger";

import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { SKILL_INIT_JOB } from "@/modules/learning/application/commands/create-skill";
import { SKILL_FIRST_LESSON_JOB } from "@/modules/tutoring/application/generate-first-lesson";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import { makeMinuteSweeper, type MinuteSweeper } from "./minute-sweeper";

/** A claimed skill's lease: updatedAt is refreshed on claim, so a fresh
 * attempt cannot be double-claimed for this long (in-flight generation keeps
 * it). */
export const INIT_STALE_MS = 120_000;

export type SkillInitSweeper = MinuteSweeper;

/**
 * Recovery net for the create-with-prompt flow's background stages:
 *
 * 1. Lost stage jobs (create-skill init, edit-armed first lesson,
 *    retry-skill): neither job has a durable row, so on the serverless API —
 *    where the in-process setImmediate queue is frozen the moment a request
 *    returns — a lost job leaves the skill stuck. Each tick claims
 *    GENERATING skills with zero classes untouched past INIT_STALE_MS and
 *    re-enqueues the right stage: description empty = metadata never landed
 *    (stage 1); description present = the lesson pipeline died (stage 2).
 *    Self-terminating: each pipeline settles the skill ACTIVE on success or
 *    FAILED on failure, and a dead provider therefore cannot loop this
 *    requeue.
 *
 * 2. Abandoned review: the draft landed (ACTIVE, zero classes) but
 *    skill.edit never accepted it — the learner walked away. Healed as
 *    implicit acceptance: claimed to GENERATING and stage 2 regenerates from
 *    the stored draft.
 *
 * 3. Abandoned generation (a pipeline dying AFTER persisting a class but
 *    before settling — a crash between class-create and settle, e.g. an
 *    expired transaction). A legal GENERATING phase always owns either zero
 *    classes (cases 1-2) or a live NextClassJob marker, so a stale
 *    GENERATING skill with a class and no marker is dead. Settled ACTIVE:
 *    the lesson exists, and the adaptive loop re-arms on the next submit.
 */
export const makeSkillInitSweeper = ({
  skillRepo,
  jobs,
}: {
  skillRepo: Pick<
    SkillRepository,
    "claimStaleInit" | "claimStaleFirstLesson" | "settleStaleGenerating"
  >;
  jobs: JobQueuePort;
}): SkillInitSweeper =>
  makeMinuteSweeper(async () => {
    try {
      const claimed = await skillRepo.claimStaleInit(
        new Date(Date.now() - INIT_STALE_MS),
      );
      for (const skill of claimed) {
        if (skill.description.length > 0) {
          jobs.enqueue(SKILL_FIRST_LESSON_JOB, {
            skillId: skill.id,
            userId: skill.userId,
          });
        } else {
          jobs.enqueue(SKILL_INIT_JOB, {
            skillId: skill.id,
            userId: skill.userId,
            prompt: skill.prompt,
          });
        }
      }
      if (claimed.length > 0) {
        logger.warn(
          { requeued: claimed.map((skill) => skill.id) },
          "Requeued lost skill generation jobs",
        );
      }
      const accepted = await skillRepo.claimStaleFirstLesson(
        new Date(Date.now() - INIT_STALE_MS),
      );
      for (const skill of accepted) {
        jobs.enqueue(SKILL_FIRST_LESSON_JOB, {
          skillId: skill.id,
          userId: skill.userId,
        });
      }
      if (accepted.length > 0) {
        logger.warn(
          { requeued: accepted.map((skill) => skill.id) },
          "Healed abandoned skill reviews as accepted (armed first lesson)",
        );
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
