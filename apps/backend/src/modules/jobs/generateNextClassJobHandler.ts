import type { SkillNextClassJobPayload } from "@/modules/tutoring/application/generate-next-class";
import type { NextClassWorker } from "@/modules/jobs/next-class-worker";

/**
 * The instant trigger for submit-quiz's in-memory job. The durable row — not
 * this call — is the source of truth: claimOne no-ops when the sweeper
 * already owns or finished the skill, so both triggers are safe together.
 */
export const getGenerateNextClassJobHandler = (nextClassWorker: NextClassWorker) => {
  return async (payload: SkillNextClassJobPayload) => {
    await nextClassWorker.runForSkill(payload.skillId);
  };
};
