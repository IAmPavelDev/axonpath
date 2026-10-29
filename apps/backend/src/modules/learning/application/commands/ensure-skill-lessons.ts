import { err, ok, type Result } from "@/modules/platform/result";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  SKILL_FIRST_LESSON_JOB,
  type SkillFirstLessonJobPayload,
} from "@/modules/tutoring/application/generate-first-lesson";

/**
 * Request-side drain budget. The serverless API freezes its in-process job
 * queue the moment a response returns, so arming paths drain the queue
 * in-request — but the API Gateway/Lambda budget is 30 s: past the cap the
 * response returns and the sweeper's stale-claim recovery finishes the run
 * (the skill sits GENERATING with a fresh lease until then).
 */
export const REQUEST_DRAIN_CAP_MS = 25_000;

/** Resolve when the queue empties, or at the cap — whichever comes first. */
export const drainCapped = async (
  awaitDrain: () => Promise<void>,
  capMs = REQUEST_DRAIN_CAP_MS,
): Promise<void> => {
  await Promise.race([
    awaitDrain(),
    new Promise<void>((resolve) => setTimeout(resolve, capMs)),
  ]);
};

export type EnsureSkillLessonsDeps = {
  skillRepo: Pick<SkillRepository, "findById" | "claimFirstLessonRun">;
  classRepo: Pick<ClassRepository, "findTopBySkill">;
  jobs: JobQueuePort;
  /** Drain seam — the container's jobQueueIdle. */
  awaitDrain: () => Promise<void>;
  /** Lease window mirroring the skill-init sweeper's INIT_STALE_MS. */
  staleMs?: number;
};

export type EnsureSkillLessonsInput = {
  skillId: number;
  userId: number;
};

export type EnsureSkillLessonsOutput = {
  status: string;
};

export type EnsureSkillLessonsError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number };

/**
 * Make sure lesson generation is running for a lesson-less skill — the
 * on-request half of "the user never waits stuck": whenever a client lands
 * on a skill with zero lessons it calls this, and generation starts now
 * instead of at the next worker sweep.
 *
 * Idempotent by construction:
 * - lessons exist → nothing to do (the adaptive loop owns further lessons);
 * - FAILED → reported, not retried — the client offers the explicit retry
 *   button and an automatic loop would burn the AI provider's balance;
 * - ACTIVE (draft landed, accepted or abandoned) or stale GENERATING (the
 *   arming job was lost to the serverless freeze) → atomically claimed and
 *   the first-lesson job runs in-request via the capped drain;
 * - fresh GENERATING → a run is plausibly in flight (worker claim or
 *   another ensure) → no-op.
 */
export const makeEnsureSkillLessons =
  ({
    skillRepo,
    classRepo,
    jobs,
    awaitDrain,
    staleMs = 120_000,
  }: EnsureSkillLessonsDeps) =>
  async (
    input: EnsureSkillLessonsInput,
  ): Promise<Result<EnsureSkillLessonsOutput, EnsureSkillLessonsError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }

    if ((await classRepo.findTopBySkill(input.skillId)) !== null) {
      return ok({ status: skill.status });
    }
    if (skill.status === SkillStatus.FAILED) {
      return ok({ status: skill.status });
    }

    const claimed = await skillRepo.claimFirstLessonRun(
      input.skillId,
      new Date(Date.now() - staleMs),
    );
    if (!claimed) {
      // Fresh GENERATING: armed moments ago elsewhere — hands off.
      return ok({ status: SkillStatus.GENERATING });
    }

    jobs.enqueue(SKILL_FIRST_LESSON_JOB, {
      skillId: input.skillId,
      userId: claimed.userId,
    } satisfies SkillFirstLessonJobPayload);
    await drainCapped(awaitDrain);

    // The drain usually settles the skill ACTIVE (lesson persisted) — read
    // the post-drain status so the client's next screen state is accurate.
    const settled = await skillRepo.findById(input.skillId);
    return ok({ status: settled?.status ?? SkillStatus.GENERATING });
  };
