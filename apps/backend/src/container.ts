import { config } from "@/modules/platform/config";
import { makePrismaSkillRepository } from "@/modules/learning/infrastructure/skill.prisma.repo";
import { makePrismaClassRepository } from "@/modules/learning/infrastructure/class.prisma.repo";
import { makePrismaQuizRepository } from "@/modules/learning/infrastructure/quiz.prisma.repo";
import { makePrismaEventRepository } from "@/modules/learning/infrastructure/event.prisma.repo";
import { makeSetImmediateJobQueue } from "@/modules/platform/infrastructure/set-immediate-jobs";
import { makeVectorStoreAdapter } from "@/modules/memory/infrastructure/vector.metadata.repo";
import { makeRetrieveRelevantContext } from "@/modules/memory/application/retrieve-relevant-context";
import { makeRecordVectors } from "@/modules/memory/application/record-vectors";
import { makeOpenRouterAi } from "@/modules/tutoring/infrastructure/openrouter.client";
import { makeGenerateInitialSkill } from "@/modules/tutoring/application/generate-initial-skill";
import { makeJobHandlers } from "@/modules/jobs/registry";
import type { LearningApiDeps } from "@/router";

/**
 * Composition root: the only place adapters are constructed and use cases are
 * bound to them. Each `make*` deps object is the future Effect Layer seam; job
 * wiring lives in modules/jobs/registry.ts. main.ts consumes this and stays
 * HTTP-only (Fastify bootstrap).
 */
export type Container = LearningApiDeps;

export const configureContainer = (): Container => {
  const skillRepo = makePrismaSkillRepository();
  const classRepo = makePrismaClassRepository();
  const quizRepo = makePrismaQuizRepository();
  const eventRepo = makePrismaEventRepository();
  const vectorStore = makeVectorStoreAdapter();
  const ai = makeOpenRouterAi();

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

  const jobs = makeSetImmediateJobQueue(makeJobHandlers({ generateInitialSkill }));

  return { skillRepo, classRepo, quizRepo, jobs };
};