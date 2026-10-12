import { logger } from "@/lib/logger";

import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import type { VideoRepository } from "@/modules/video/domain/video-repos";
import { makeMinuteSweeper, type MinuteSweeper } from "./minute-sweeper";
import { CLASS_VIDEO_CLIPS_JOB } from "@/modules/video/application/generate-class-clips";

/** Fresh classes get one quiet minute before enrichment claims them. */
export const CLIPS_CLAIM_AGE_MS = 60_000;
/** One claim = one attempt; Gemini passes can take minutes, so the lease
 * must outlive them: re-claim only after this long without settlement. */
export const CLIPS_LEASE_MS = 8 * 60_000;
/** Attempts budget before the silent give-up flips the class SKIPPED. */
export const CLIPS_MAX_ATTEMPTS = 3;

export type ClassClipsSweeper = MinuteSweeper;

/**
 * Trigger AND recovery net for lesson video clips: class creation sets
 * clipStatus PENDING; each tick first retires exhausted classes (silent
 * SKIPPED), then claims lease-expired PENDING classes and enqueues the job.
 */
export const makeClassClipsSweeper = ({
  videoRepo,
  jobs,
}: {
  videoRepo: VideoRepository;
  jobs: JobQueuePort;
}): ClassClipsSweeper =>
  makeMinuteSweeper(async () => {
    try {
      await videoRepo.failStaleClipClasses(CLIPS_MAX_ATTEMPTS);
      const claimed = await videoRepo.claimStaleClipClasses(
        new Date(Date.now() - CLIPS_LEASE_MS),
      );
      for (const klass of claimed) {
        // Enqueue only classes old enough to settle their first minute —
        // brand-new classes are picked up on a later tick.
        jobs.enqueue(CLASS_VIDEO_CLIPS_JOB, { classId: klass.id });
      }
      if (claimed.length > 0) {
        logger.info({ requeued: claimed.map((klass) => klass.id) }, "Queued class video clips");
      }
    } catch (err) {
      logger.error({ err }, "Class clips sweep failed");
    }
  });
