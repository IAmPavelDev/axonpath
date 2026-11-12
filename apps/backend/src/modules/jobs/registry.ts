import type { JobHandler } from "@/modules/platform/ports/jobs";
import { SKILL_INIT_JOB } from "@/modules/learning/application/commands/create-skill";
import { SKILL_NEXT_CLASS_JOB } from "@/modules/tutoring/application/generate-next-class";
import { SKILL_FIRST_LESSON_JOB } from "@/modules/tutoring/application/generate-first-lesson";
import {
  CLASS_QA_ANSWER_JOB,
  type AnswerClassQuestion,
} from "@/modules/tutoring/application/answer-class-question";
import type { GenerateSkillMetadata } from "@/modules/tutoring/application/generate-skill-metadata";
import type { GenerateFirstLesson } from "@/modules/tutoring/application/generate-first-lesson";
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
import { getGenerateSkillMetadataJobHandler } from "./generateSkillMetadataJobHandler";
import { getGenerateFirstLessonJobHandler } from "./generateFirstLessonJobHandler";
import { getGenerateNextClassJobHandler } from "./generateNextClassJobHandler";
import { getAnswerClassQuestionJobHandler } from "./answerClassQuestionJobHandler";
import { getMineAnswerVectorsJobHandler } from "./mineAnswerVectorsJobHandler";
import { getMineQaVectorsJobHandler } from "./mineQaVectorsJobHandler";
import { getVectorizeClassContentJobHandler } from "./vectorizeClassContentJobHandler";
import { getGradeOpenEndedJobHandler } from "./gradeOpenEndedJobHandler";
import { getSkillRecommendationsJobHandler } from "./skill-recommendations-job-handler";
import { getClassVideoClipsJobHandler } from "./class-video-clips-job-handler";
import { getClassQuizJobHandler } from "./class-quiz-job-handler";
import type { GenerateSkillRecommendations } from "@/modules/video/application/generate-skill-recommendations";
import type { GenerateClassClips } from "@/modules/video/application/generate-class-clips";
import type { GenerateClassQuiz } from "@/modules/tutoring/application/generate-class-quiz";
import { CLASS_QUIZ_JOB } from "@/modules/tutoring/application/generate-class-quiz";
import { SKILL_RECOMMENDATIONS_JOB } from "@/modules/video/application/generate-skill-recommendations";
import { CLASS_VIDEO_CLIPS_JOB } from "@/modules/video/application/generate-class-clips";

/**
 * Job configuration: maps job names to their handlers. The composition root
 * hands in the already-built use cases/worker; this module owns the job-name →
 * handler wiring and the failure policy per job, so main.ts never references
 * AI/tutoring logic directly. Adding a job = adding an entry here.
 */
export type JobRegistryDeps = {
  generateSkillMetadata: GenerateSkillMetadata;
  generateFirstLesson: GenerateFirstLesson;
  nextClassWorker: NextClassWorker;
  answerClassQuestion: AnswerClassQuestion;
  mineAnswerVectors: MineAnswerVectors;
  mineQaVectors: MineQaVectors;
  vectorizeClassContent: VectorizeClassContent;
  gradeOpenEnded: GradeOpenEnded;
  generateSkillRecommendations: GenerateSkillRecommendations;
  generateClassClips: GenerateClassClips;
  generateClassQuiz: GenerateClassQuiz;
};

export const makeJobHandlers = ({
  generateSkillMetadata,
  generateFirstLesson,
  nextClassWorker,
  answerClassQuestion,
  mineAnswerVectors,
  mineQaVectors,
  vectorizeClassContent,
  gradeOpenEnded,
  generateSkillRecommendations,
  generateClassClips,
  generateClassQuiz,
}: JobRegistryDeps): Record<string, JobHandler> => ({
  [SKILL_INIT_JOB]: getGenerateSkillMetadataJobHandler(generateSkillMetadata),
  [SKILL_FIRST_LESSON_JOB]: getGenerateFirstLessonJobHandler(generateFirstLesson),
  [SKILL_NEXT_CLASS_JOB]: getGenerateNextClassJobHandler(nextClassWorker),
  [CLASS_QA_ANSWER_JOB]: getAnswerClassQuestionJobHandler(answerClassQuestion),
  [SKILL_ANSWER_VECTORS_JOB]: getMineAnswerVectorsJobHandler(mineAnswerVectors),
  [QA_BLOCK_VECTORS_JOB]: getMineQaVectorsJobHandler(mineQaVectors),
  [CLASS_CONTENT_VECTORS_JOB]: getVectorizeClassContentJobHandler(vectorizeClassContent),
  [GRADE_OPEN_ENDED_JOB]: getGradeOpenEndedJobHandler(gradeOpenEnded),
  [SKILL_RECOMMENDATIONS_JOB]: getSkillRecommendationsJobHandler(
    generateSkillRecommendations,
  ),
  [CLASS_VIDEO_CLIPS_JOB]: getClassVideoClipsJobHandler(generateClassClips),
  [CLASS_QUIZ_JOB]: getClassQuizJobHandler(generateClassQuiz),
});
