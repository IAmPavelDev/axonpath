import type { JobHandler } from "@/modules/platform/ports/jobs";
import { SKILL_INIT_JOB } from "@/modules/learning/application/commands/create-skill";
import type { GenerateInitialSkill } from "@/modules/tutoring/application/generate-initial-skill";
import { getGenerateInitialSkillJobHandler } from "./generateInitialSkillJobHandler";

/**
 * Job configuration: maps job names to their handlers. The composition root
 * hands in the already-built use cases; this module owns the job-name →
 * handler wiring and the failure policy per job, so main.ts never references
 * AI/tutoring logic directly. Adding a job = adding an entry here.
 */
export type JobRegistryDeps = {
  generateInitialSkill: GenerateInitialSkill;
};

export const makeJobHandlers = ({
  generateInitialSkill,
}: JobRegistryDeps): Record<string, JobHandler> => ({
  [SKILL_INIT_JOB]: getGenerateInitialSkillJobHandler(generateInitialSkill),
});
