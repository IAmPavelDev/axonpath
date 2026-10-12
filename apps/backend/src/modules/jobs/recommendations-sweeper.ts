import { logger } from "@/lib/logger";

import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import type { VideoRepository } from "@/modules/video/domain/video-repos";
import { makeMinuteSweeper, type MinuteSweeper } from "./minute-sweeper";
import { SKILL_RECOMMENDATIONS_JOB } from "@/modules/video/application/generate-skill-recommendations";

/** One claim = one attempt; a fresh PENDING skill waits out this window. */
export const RECOMMENDATIONS_CLAIM_AGE_MS = 45_000;

export type RecommendationsSweeper = MinuteSweeper;

/**
 * Recovery net AND the primary trigger for skill recommendations: creation
 * only flips the skill to PENDING; this sweeper claims stale PENDING skills
 * (updatedAt doubles as the lease, like skill-init) and enqueues the job.
 * The worker runs it on the minute tick; self-terminating via the attempts
 * budget (job flips the skill READY or FAILED).
 */
export const makeRecommendationsSweeper = ({
  videoRepo,
  jobs,
}: {
  videoRepo: VideoRepository;
  jobs: JobQueuePort;
}): RecommendationsSweeper =>
  makeMinuteSweeper(async () => {
    try {
      const claimed = await videoRepo.claimStaleRecommendationSkills(
        new Date(Date.now() - RECOMMENDATIONS_CLAIM_AGE_MS),
      );
      for (const skill of claimed) {
        jobs.enqueue(SKILL_RECOMMENDATIONS_JOB, { skillId: skill.id });
      }
      if (claimed.length > 0) {
        logger.info({ requeued: claimed.map((skill) => skill.id) }, "Queued skill recommendations");
      }
    } catch (err) {
      logger.error({ err }, "Recommendations sweep failed");
    }
  });

