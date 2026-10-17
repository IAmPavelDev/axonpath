import { logger } from "@/lib/logger";

import type { GenerateNextClass } from "@/modules/tutoring/application/generate-next-class";
import type {
  NextClassJobClaim,
  NextClassJobRepository,
} from "@/modules/jobs/next-class-job.repository";

/**
 * How long a claimed row stays PROCESSING before another tick may steal it.
 * Generation takes ~2-4 min (reasoning model); the lease is generous headroom,
 * trading slow crash-recovery for zero chance of double generation.
 */
export const NEXT_CLASS_LEASE_MINUTES = 15;

/** Failed attempts before the marker is dropped (success path never hits it). */
export const MAX_NEXT_CLASS_ATTEMPTS = 3;

export type NextClassWorker = {
  /** Process one claimed job to completion: run, then release or requeue. */
  run(claim: NextClassJobClaim): Promise<void>;
  /**
   * Instant trigger (submit-quiz's in-memory job): claim the skill's marker
   * and run. False = nothing to do — the sweeper already owns or finished it.
   */
  runForSkill(skillId: number): Promise<boolean>;
};

export const makeNextClassWorker = ({
  nextClassJobs,
  generateNextClass,
}: {
  nextClassJobs: NextClassJobRepository;
  generateNextClass: GenerateNextClass;
}): NextClassWorker => {
  const run = async (claim: NextClassJobClaim): Promise<void> => {
    const startedAt = Date.now();
    const result = await generateNextClass({
      skillId: claim.skillId,
      userId: claim.userId,
    });

    if (result.ok) {
      await nextClassJobs.release(claim);
      return;
    }

    logger.error({
      skillId: claim.skillId,
      userId: claim.userId,
      error: result.error,
      attempt: claim.attempts,
      maxAttempts: MAX_NEXT_CLASS_ATTEMPTS,
      durationMs: Date.now() - startedAt,
    }, "Next-class generation failed; skill stays ACTIVE");

    if (claim.attempts >= MAX_NEXT_CLASS_ATTEMPTS) {
      logger.error({
        skillId: claim.skillId,
        userId: claim.userId,
        error: result.error,
        attempt: claim.attempts,
        maxAttempts: MAX_NEXT_CLASS_ATTEMPTS,
      }, `Next-class generation giving up after ${claim.attempts} attempts; will re-arm via reconciliation once the skill settles ACTIVE`);
      await nextClassJobs.release(claim);
      return;
    }

    await nextClassJobs.requeue(claim);
  };

  const runForSkill = async (skillId: number): Promise<boolean> => {
    const claim = await nextClassJobs.claimOne({
      skillId,
      leaseMinutes: NEXT_CLASS_LEASE_MINUTES,
    });
    if (!claim) return false;
    await run(claim);
    return true;
  };

  return { run, runForSkill };
};
