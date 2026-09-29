import { config } from "@/modules/platform/config";
import { makePrismaSkillRepository } from "@/modules/learning/infrastructure/skill.prisma.repo";
import { makePrismaClassRepository } from "@/modules/learning/infrastructure/class.prisma.repo";
import { makePrismaClassQaRepository } from "@/modules/learning/infrastructure/class-qa.prisma.repo";
import { makePrismaQuizRepository } from "@/modules/learning/infrastructure/quiz.prisma.repo";
import { makePrismaEventRepository } from "@/modules/learning/infrastructure/event.prisma.repo";
import { makeSetImmediateJobQueue } from "@/modules/platform/infrastructure/set-immediate-jobs";
import { makeVectorStoreAdapter } from "@/modules/memory/infrastructure/vector.metadata.repo";
import { makeRetrieveRelevantContext } from "@/modules/memory/application/retrieve-relevant-context";
import { makeRecordVectors } from "@/modules/memory/application/record-vectors";
import { makeZaiAi } from "@/modules/tutoring/infrastructure/zai.client";
import { makeGenerateInitialSkill } from "@/modules/tutoring/application/generate-initial-skill";
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
import type { LearningApiDeps } from "@/router";

/**
 * Composition root: the only place adapters are constructed and use cases are
 * bound to them. Each `make*` deps object is the future Effect Layer seam; job
 * wiring lives in modules/jobs/registry.ts. main.ts consumes this and stays
 * HTTP-only (Fastify bootstrap).
 */
export type Container = LearningApiDeps & {
  /** Started by main.ts after listen; stopped on shutdown. */
  nextClassSweeper: NextClassSweeper;
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

  const nextClassJobs = makePrismaNextClassJobRepository();
  const nextClassWorker = makeNextClassWorker({
    nextClassJobs,
    generateNextClass,
  });

  const jobs = makeSetImmediateJobQueue(
    makeJobHandlers({ generateInitialSkill, nextClassWorker, answerClassQuestion }),
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

  return {
    skillRepo,
    classRepo,
    qaRepo,
    quizRepo,
    eventRepo,
    jobs,
    nextClassJobs,
    nextClassSweeper,
  };
};
