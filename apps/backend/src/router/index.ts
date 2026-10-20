import { rpc } from "@/lib/orpc";
import {
  makeSkillHandlers,
  type SkillApiDeps,
} from "@/modules/learning/api/skill.handlers";
import {
  makeClassHandlers,
  type ClassApiDeps,
} from "@/modules/learning/api/class.handlers";
import {
  makeQuizHandlers,
  type QuizApiDeps,
} from "@/modules/learning/api/quiz.handlers";
import { makeAuthHandlers } from "@/modules/identity/api/auth.handlers";
import {
  makeStatsHandlers,
  type StatsApiDeps,
} from "@/modules/learning/api/stats.handlers";

import {
  makeVideoHandlers,
  type VideoApiDeps,
} from "@/modules/video/api/video.handlers";

export type LearningApiDeps = SkillApiDeps &
  ClassApiDeps &
  QuizApiDeps &
  StatsApiDeps &
  VideoApiDeps;

export const buildSkillRouter = (deps: SkillApiDeps) => {
  const handlers = makeSkillHandlers(deps);
  return {
    create: rpc.skill.create.handler(handlers.create),
    edit: rpc.skill.edit.handler(handlers.edit),
    get: rpc.skill.get.handler(handlers.get),
    list: rpc.skill.list.handler(handlers.list),
    progress: rpc.skill.progress.handler(handlers.progress),
    mistakes: rpc.skill.mistakes.handler(handlers.mistakes),
    delete: rpc.skill.delete.handler(handlers.delete),
  };
};

export const buildClassRouter = (deps: ClassApiDeps) => {
  const handlers = makeClassHandlers(deps);
  return {
    list: rpc.class.list.handler(handlers.list),
    get: rpc.class.get.handler(handlers.get),
    qa: {
      ask: rpc.class.qa.ask.handler(handlers.qa.ask),
      retry: rpc.class.qa.retry.handler(handlers.qa.retry),
      list: rpc.class.qa.list.handler(handlers.qa.list),
    },
  };
};

export const buildQuizRouter = (deps: QuizApiDeps) => {
  const handlers = makeQuizHandlers(deps);
  return {
    get: rpc.quiz.get.handler(handlers.get),
    submit: rpc.quiz.submit.handler(handlers.submit),
    result: rpc.quiz.result.handler(handlers.result),
  };
};

export const buildAuthRouter = () => {
  const handlers = makeAuthHandlers();
  return {
    me: rpc.auth.me.handler(handlers.me),
  };
};

export const buildStatsRouter = (deps: StatsApiDeps) => {
  const handlers = makeStatsHandlers(deps);
  return {
    overview: rpc.stats.overview.handler(handlers.overview),
    report: rpc.stats.report.handler(handlers.report),
  };
};
export const buildVideoRouter = (deps: VideoApiDeps) => {
  const handlers = makeVideoHandlers(deps);
  return {
    probe: rpc.video.probe.handler(handlers.probe),
    recommendations: {
      list: rpc.video.recommendations.list.handler(handlers.recommendationsList),
      refresh: rpc.video.recommendations.refresh.handler(
        handlers.recommendationsRefresh,
      ),
    },
    sponsorSegments: rpc.video.sponsorSegments.handler(handlers.sponsorSegments),
  };
};

export const buildRouters = (deps: LearningApiDeps) => ({
  skill: buildSkillRouter(deps),
  class: buildClassRouter(deps),
  quiz: buildQuizRouter(deps),
  auth: buildAuthRouter(),
  stats: buildStatsRouter(deps),
  video: buildVideoRouter(deps),
});
