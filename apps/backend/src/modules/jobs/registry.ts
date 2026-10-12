import type { JobHandler } from "@/modules/platform/ports/jobs";
import { SKILL_INIT_JOB } from "@/modules/learning/application/commands/create-skill";
import { SKILL_NEXT_CLASS_JOB } from "@/modules/tutoring/application/generate-next-class";
import {
  SKILL_CLASS_OPTIONS_JOB,
  type GenerateClassOptions,
} from "@/modules/tutoring/application/generate-class-options";
import {
  CLASS_QA_ANSWER_JOB,
  type AnswerClassQuestion,
} from "@/modules/tutoring/application/answer-class-question";
import type { GenerateInitialSkill } from "@/modules/tutoring/application/generate-initial-skill";
import type { NextClassWorker } from "@/modules/jobs/next-class-worker";
import {
  SKILL_ANSWER_VECTORS_JOB,
  type MineAnswerVectors,
} from "@/modules/memory/application/mine-answer-vectors";
import {
  QA_BLOCK_VECTORS_JOB,
  type MineQaVectors,
} from "@/modules/memory/application/mine-qa-vectors";
import {
  CLASS_CONTENT_VECTORS_JOB,
  type VectorizeClassContent,
} from "@/modules/memory/application/vectorize-class-content";
import {
  GRADE_OPEN_ENDED_JOB,
  type GradeOpenEnded,
} from "@/modules/tutoring/application/grade-open-ended";
import { getGenerateInitialSkillJobHandler } from "./generateInitialSkillJobHandler";
import { getGenerateNextClassJobHandler } from "./generateNextClassJobHandler";
import { getAnswerClassQuestionJobHandler } from "./answerClassQuestionJobHandler";
import { getMineAnswerVectorsJobHandler } from "./mineAnswerVectorsJobHandler";
import { getMineQaVectorsJobHandler } from "./mineQaVectorsJobHandler";
import { getVectorizeClassContentJobHandler } from "./vectorizeClassContentJobHandler";
import { getGradeOpenEndedJobHandler } from "./gradeOpenEndedJobHandler";
import { getGenerateClassOptionsJobHandler } from "./generateClassOptionsJobHandler";
import { getSkillRecommendationsJobHandler } from "./skill-recommendations-job-handler";
import { getClassVideoClipsJobHandler } from "./class-video-clips-job-handler";
import type { GenerateSkillRecommendations } from "@/modules/video/application/generate-skill-recommendations";
import type { GenerateClassClips } from "@/modules/video/application/generate-class-clips";
import { SKILL_RECOMMENDATIONS_JOB } from "@/modules/video/application/generate-skill-recommendations";
import { CLASS_VIDEO_CLIPS_JOB } from "@/modules/video/application/generate-class-clips";

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
  mineAnswerVectors: MineAnswerVectors;
  mineQaVectors: MineQaVectors;
  vectorizeClassContent: VectorizeClassContent;
  gradeOpenEnded: GradeOpenEnded;
  generateClassOptions: GenerateClassOptions;
  generateSkillRecommendations: GenerateSkillRecommendations;
  generateClassClips: GenerateClassClips;
};

export const makeJobHandlers = ({
  generateInitialSkill,
  nextClassWorker,
  answerClassQuestion,
  mineAnswerVectors,
  mineQaVectors,
  vectorizeClassContent,
  gradeOpenEnded,
  generateClassOptions,
  generateSkillRecommendations,
  generateClassClips,
}: JobRegistryDeps): Record<string, JobHandler> => ({
  [SKILL_INIT_JOB]: getGenerateInitialSkillJobHandler(generateInitialSkill),
  [SKILL_NEXT_CLASS_JOB]: getGenerateNextClassJobHandler(nextClassWorker),
  [SKILL_CLASS_OPTIONS_JOB]: getGenerateClassOptionsJobHandler(generateClassOptions),
  [CLASS_QA_ANSWER_JOB]: getAnswerClassQuestionJobHandler(answerClassQuestion),
  [SKILL_ANSWER_VECTORS_JOB]: getMineAnswerVectorsJobHandler(mineAnswerVectors),
  [QA_BLOCK_VECTORS_JOB]: getMineQaVectorsJobHandler(mineQaVectors),
  [CLASS_CONTENT_VECTORS_JOB]: getVectorizeClassContentJobHandler(vectorizeClassContent),
  [GRADE_OPEN_ENDED_JOB]: getGradeOpenEndedJobHandler(gradeOpenEnded),
  [SKILL_RECOMMENDATIONS_JOB]: getSkillRecommendationsJobHandler(
    generateSkillRecommendations,
  ),
  [CLASS_VIDEO_CLIPS_JOB]: getClassVideoClipsJobHandler(generateClassClips),
});
