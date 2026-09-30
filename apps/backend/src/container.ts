import { config } from "@/modules/platform/config";
import { makePrismaSkillRepository } from "@/modules/learning/infrastructure/skill.prisma.repo";
import { makePrismaClassRepository } from "@/modules/learning/infrastructure/class.prisma.repo";
import { makePrismaClassQaRepository } from "@/modules/learning/infrastructure/class-qa.prisma.repo";
import { makePrismaQuizRepository } from "@/modules/learning/infrastructure/quiz.prisma.repo";
import { makePrismaEventRepository } from "@/modules/learning/infrastructure/event.prisma.repo";
import { makeSetImmediateJobQueue } from "@/modules/platform/infrastructure/set-immediate-jobs";
import { makeVectorStoreAdapter } from "@/modules/memory/infrastructure/vector.metadata.repo";
import { makeVectorMetadataRepository } from "@/modules/memory/infrastructure/vector.metadata.repo";
import { makeRetrieveRelevantContext } from "@/modules/memory/application/retrieve-relevant-context";
import { makeRecordVectors } from "@/modules/memory/application/record-vectors";
import { makeMineAnswerVectors } from "@/modules/memory/application/mine-answer-vectors";
import { makeGradeOpenEnded } from "@/modules/tutoring/application/grade-open-ended";
import { makeGenerateInitialSkill } from "@/modules/tutoring/application/generate-initial-skill";
import { makeZaiAi } from "@/modules/tutoring/infrastructure/zai.client";
import {
  makeGetUsageReport,
  type GetUsageReport,
} from "@/modules/learning/application/queries/get-usage-report";
import { makeGenerateNextClass } from "@/modules/tutoring/application/generate-next-class";
import { makeAnswerClassQuestion } from "@/modules/tutoring/application/answer-class-question";
import { makeJobHandlers } from "@/modules/jobs/registry";
import {
  makePrismaNextClassJobRepository,
} from "@/modules/jobs/infrastructure/next-class-job.prisma.repo";
import { makeNextClassReconciler } from "@/modules/jobs/next-class-reconciler";
import { makeNextClassWorker } from "@/modules/jobs/next-class-worker";
import {
  makeNextClassSweeper,
  type NextClassSweeper,
} from "@/modules/jobs/next-class-sweeper";
import {
  makeClassQaSweeper,
  type ClassQaSweeper,
} from "@/modules/jobs/class-qa-sweeper";
import type { LearningApiDeps } from "@/router";

export type Container = LearningApiDeps & {
  /** Started by main.ts after listen; stopped on shutdown. */
  nextClassSweeper: NextClassSweeper;
  classQaSweeper: ClassQaSweeper;
  /** Bound for the stats router; stats deps carry it into the API surface. */
  getUsageReport: GetUsageReport;
};

export const configureContainer = (): Container => {
  const skillRepo = makePrismaSkillRepository();
  const classRepo = makePrismaClassRepository();
  const qaRepo = makePrismaClassQaRepository();
  const quizRepo = makePrismaQuizRepository();
  const eventRepo = makePrismaEventRepository();
  const vectorStore = makeVectorStoreAdapter();
  const ai = makeZaiAi();

  const retrieveContext = makeRetrieveRelevantContext({ ai, vectorStore });
  const recordVectors = makeRecordVectors({ vectorStore });

  const generateInitialSkill = makeGenerateInitialSkill({
    ai,
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    eventRepo,
    recordVectors,
    chatModel: config.ai.models.chat,
  });

  const generateNextClass = makeGenerateNextClass({
    ai,
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    eventRepo,
    recordVectors,
    chatModel: config.ai.models.chat,
  });

  const answerClassQuestion = makeAnswerClassQuestion({
    ai,
    qaRepo,
    classRepo,
    eventRepo,
    chatModel: config.ai.models.chat,
  });

  const vectorMetadata = makeVectorMetadataRepository();

  const mineAnswerVectors = makeMineAnswerVectors({
    ai,
    vectorMetadata,
    recordVectors,
    quizRepo,
    classRepo,
  });

  const getUsageReport = makeGetUsageReport({
    skillRepo,
    eventRepo,
    vectorMetadata,
    chatModel: config.ai.models.chat,
    embeddingModel: config.ai.models.embedding,
  });

  const gradeOpenEnded = makeGradeOpenEnded({ ai, quizRepo });

  const nextClassJobs = makePrismaNextClassJobRepository();
  const nextClassWorker = makeNextClassWorker({
    nextClassJobs,
    generateNextClass,
  });

  const jobs = makeSetImmediateJobQueue(
    makeJobHandlers({
      generateInitialSkill,
      nextClassWorker,
      answerClassQuestion,
      mineAnswerVectors,
      gradeOpenEnded,
    }),
  );

  const nextClassReconciler = makeNextClassReconciler({
    skillRepo,
    classRepo,
    quizRepo,
    nextClassJobs,
  });

  const nextClassSweeper = makeNextClassSweeper({
    reconcile: nextClassReconciler,
    nextClassJobs,
    run: nextClassWorker.run,
  });

  const classQaSweeper = makeClassQaSweeper({ qaRepo, jobs });

  return {
    skillRepo,
    classRepo,
    qaRepo,
    quizRepo,
    eventRepo,
    vectorMetadata,
    chatModel: config.ai.models.chat,
    embeddingModel: config.ai.models.embedding,
    getUsageReport,
    jobs,
    nextClassJobs,
    nextClassSweeper,
    classQaSweeper,
  };
};
