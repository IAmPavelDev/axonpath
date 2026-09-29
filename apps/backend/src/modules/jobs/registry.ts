import type { JobHandler } from "@/modules/platform/ports/jobs";
import { SKILL_INIT_JOB } from "@/modules/learning/application/commands/create-skill";
import { SKILL_NEXT_CLASS_JOB } from "@/modules/tutoring/application/generate-next-class";
import {
  CLASS_QA_ANSWER_JOB,
  type AnswerClassQuestion,
} from "@/modules/tutoring/application/answer-class-question";
import type { GenerateInitialSkill } from "@/modules/tutoring/application/generate-initial-skill";
import type { NextClassWorker } from "@/modules/jobs/next-class-worker";
import { getGenerateInitialSkillJobHandler } from "./generateInitialSkillJobHandler";
import { getGenerateNextClassJobHandler } from "./generateNextClassJobHandler";
import { getAnswerClassQuestionJobHandler } from "./answerClassQuestionJobHandler";

/**
 * Job configuration: maps job names to their handlers. The composition root
 * hands in the already-built use cases/worker; this module owns the job-name →
 * handler wiring and the failure policy per job, so main.ts never references
 * AI/tutoring logic directly. Adding a job = adding an entry here.
 */
export type JobRegistryDeps = {
  generateInitialSkill: GenerateInitialSkill;
  nextClassWorker: NextClassWorker;
  answerClassQuestion: AnswerClassQuestion;
};

export const makeJobHandlers = ({
  generateInitialSkill,
  nextClassWorker,
  answerClassQuestion,
}: JobRegistryDeps): Record<string, JobHandler> => ({
  [SKILL_INIT_JOB]: getGenerateInitialSkillJobHandler(generateInitialSkill),
  [SKILL_NEXT_CLASS_JOB]: getGenerateNextClassJobHandler(nextClassWorker),
  [CLASS_QA_ANSWER_JOB]: getAnswerClassQuestionJobHandler(answerClassQuestion),
});
