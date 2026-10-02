import { config } from "@/modules/platform/config";
import { makeSystemClock } from "@/modules/platform/ports/clock";
import { makePrismaSkillRepository } from "@/modules/learning/infrastructure/skill.prisma.repo";
import { makePrismaNextClassOptionRepository } from "@/modules/learning/infrastructure/next-class-option.prisma.repo";
import { makePrismaClassRepository } from "@/modules/learning/infrastructure/class.prisma.repo";
import { makePrismaClassQaRepository } from "@/modules/learning/infrastructure/class-qa.prisma.repo";
import { makePrismaQuizRepository } from "@/modules/learning/infrastructure/quiz.prisma.repo";
import { makePrismaEventRepository } from "@/modules/learning/infrastructure/event.prisma.repo";
import { makeSetImmediateJobQueue } from "@/modules/platform/infrastructure/set-immediate-jobs";
import { makeVectorStoreAdapter } from "@/modules/memory/infrastructure/vector.metadata.repo";
import { makeVectorMetadataRepository } from "@/modules/memory/infrastructure/vector.metadata.repo";
import { makeRetrieveRelevantContext } from "@/modules/memory/application/retrieve-relevant-context";
import { makeRetrieveQaContext } from "@/modules/memory/application/retrieve-qa-context";
import { makeRecordVectors } from "@/modules/memory/application/record-vectors";
import { makeMineAnswerVectors } from "@/modules/memory/application/mine-answer-vectors";
import { makeMineQaVectors } from "@/modules/memory/application/mine-qa-vectors";
import { makeVectorizeClassContent } from "@/modules/memory/application/vectorize-class-content";
import { makeGradeOpenEnded } from "@/modules/tutoring/application/grade-open-ended";
import { makeGenerateInitialSkill } from "@/modules/tutoring/application/generate-initial-skill";
import { makeZaiAi } from "@/modules/tutoring/infrastructure/zai.client";
import {
  makeGetUsageReport,
  type GetUsageReport,
} from "@/modules/learning/application/queries/get-usage-report";
import { makeGenerateNextClass } from "@/modules/tutoring/application/generate-next-class";
import {
  makeGenerateClassOptions,
} from "@/modules/tutoring/application/generate-class-options";
import { makeAnswerClassQuestion } from "@/modules/tutoring/application/answer-class-question";
import { makeJobHandlers } from "@/modules/jobs/registry";
import type { JobHandler, JobQueuePort } from "@/modules/platform/ports/jobs";
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
  /**
   * Resolves when every setImmediate job — including follow-up jobs enqueued
   * by jobs — has settled. The Lambda worker drains on it before returning;
   * the server never waits (fire-and-forget is the point there).
   */
  jobQueueIdle: () => Promise<void>;
  /** Bound for the stats router; stats deps carry it into the API surface. */
  getUsageReport: GetUsageReport;
};

export const configureContainer = (
  { sweeperMode = 'server' }: { sweeperMode?: 'server' | 'worker' } = {},
): Container => {
  const skillRepo = makePrismaSkillRepository();
  const classRepo = makePrismaClassRepository();
  const optionRepo = makePrismaNextClassOptionRepository();
  const qaRepo = makePrismaClassQaRepository();
  const quizRepo = makePrismaQuizRepository();
  const eventRepo = makePrismaEventRepository();
  const vectorStore = makeVectorStoreAdapter();
  const ai = makeZaiAi();

  const retrieveContext = makeRetrieveRelevantContext({ ai, vectorStore });
  const retrieveQaContext = makeRetrieveQaContext({ ai, vectorStore });
  const recordVectors = makeRecordVectors({ vectorStore });
  const vectorMetadata = makeVectorMetadataRepository();

  // The generation/QA pipelines enqueue follow-up memory jobs, and the job
  // handlers wrap those same pipelines — the cycle resolves through the
  // handlers record, which is filled in after the use cases are built
  const jobHandlers: Record<string, JobHandler> = {};
  const jobQueue = makeSetImmediateJobQueue(jobHandlers);
  const jobs: JobQueuePort = jobQueue;

  const vectorizeClassContent = makeVectorizeClassContent({
    ai,
    vectorMetadata,
    recordVectors,
    classRepo,
    skillRepo,
  });

  const generateInitialSkill = makeGenerateInitialSkill({
    ai,
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    eventRepo,
    recordVectors,
    chatModel: config.ai.models.chat,
    jobs,
  });

  const clock = makeSystemClock();

  const generateNextClass = makeGenerateNextClass({
    ai,
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    eventRepo,
    clock,
    recordVectors,
    chatModel: config.ai.models.chat,
    jobs,
  });

  const generateClassOptions = makeGenerateClassOptions({
    ai,
    retrieveContext,
    skillRepo,
    optionRepo,
    classRepo,
    quizRepo,
    eventRepo,
    clock,
  });

  const answerClassQuestion = makeAnswerClassQuestion({
    ai,
    qaRepo,
    classRepo,
    skillRepo,
    eventRepo,
    chatModel: config.ai.models.chat,
    retrieveQaContext,
    vectorizeClassContent,
    jobs,
  });

  const mineAnswerVectors = makeMineAnswerVectors({
    ai,
    vectorMetadata,
    recordVectors,
    quizRepo,
    classRepo,
  });

  const mineQaVectors = makeMineQaVectors({
    ai,
    vectorMetadata,
    recordVectors,
    qaRepo,
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

  Object.assign(
    jobHandlers,
    makeJobHandlers({
      generateInitialSkill,
      nextClassWorker,
      answerClassQuestion,
      mineAnswerVectors,
      mineQaVectors,
      vectorizeClassContent,
      gradeOpenEnded,
      generateClassOptions,
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
    // Worker mode owns sweeping inline; server mode stays fire-and-forget.
    awaitRuns: sweeperMode === 'worker',
  });
  const classQaSweeper = makeClassQaSweeper({ qaRepo, jobs });

  return {
    skillRepo,
    classRepo,
    optionRepo,
    qaRepo,
    quizRepo,
    eventRepo,
    vectorMetadata,
    chatModel: config.ai.models.chat,
    embeddingModel: config.ai.models.embedding,
    getUsageReport,
    clock,
    jobs,
    jobQueueIdle: jobQueue.idle,
    nextClassJobs,
    nextClassSweeper,
    classQaSweeper,
  };
};
