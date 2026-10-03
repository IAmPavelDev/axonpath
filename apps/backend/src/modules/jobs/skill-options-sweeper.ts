import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import { SKILL_CLASS_OPTIONS_JOB } from "@/modules/tutoring/application/generate-class-options";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import { makeMinuteSweeper, type MinuteSweeper } from "./minute-sweeper";

/** PENDING options untouched this long lost their job (serverless freeze). */
export const OPTIONS_STALE_MS = 120_000;

export type SkillOptionsSweeper = MinuteSweeper;

/**
 * Recovery net for the MANUAL-mode candidate-options job: like skill-init,
 * it has no durable row and dies with the API request on serverless, leaving
 * optionsState PENDING forever. Each tick re-enqueues stale PENDING skills.
 * Self-terminating: the job settles READY or FAILED, and a non-ACTIVE skill
 * is reset to NONE by the job itself.
 */
export const makeSkillOptionsSweeper = ({
  skillRepo,
  jobs,
}: {
  skillRepo: Pick<SkillRepository, "listStalePendingOptions">;
  jobs: JobQueuePort;
}): SkillOptionsSweeper =>
  makeMinuteSweeper(async () => {
    try {
      const stale = await skillRepo.listStalePendingOptions(
        new Date(Date.now() - OPTIONS_STALE_MS),
      );
      for (const skill of stale) {
        jobs.enqueue(SKILL_CLASS_OPTIONS_JOB, {
          skillId: skill.id,
          userId: skill.userId,
        });
      }
      if (stale.length > 0) {
        console.warn(
          { requeued: stale.map((skill) => skill.id) },
          "Requeued lost skill-class-options jobs",
        );
      }
    } catch (err) {
      console.error({ err }, "Skill-options sweep failed");
    }
  });
