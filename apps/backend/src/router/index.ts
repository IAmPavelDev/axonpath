import type { ApiHandlers } from "@/lib/routes";
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

/**
 * Flat handler registry keyed by the route table's operationId — the pairing
 * that `registerApiRoutes` consumes. Keys must match `ROUTES[].id` in
 * @axon/api-contract (a missing key fails loudly at registration).
 */
export const buildApiHandlers = (deps: LearningApiDeps): ApiHandlers => {
  const skill = makeSkillHandlers(deps);
  const cls = makeClassHandlers(deps);
  const quiz = makeQuizHandlers(deps);
  const auth = makeAuthHandlers();
  const stats = makeStatsHandlers(deps);
  const video = makeVideoHandlers(deps);

  return {
    // auth
    getMe: auth.me,
    // skill
    listSkills: skill.list,
    createSkill: skill.create,
    getSkillById: skill.get,
    editSkill: skill.edit,
    retrySkill: skill.retry,
    ensureSkillLessons: skill.ensure,
    getSkillProgress: skill.progress,
    updateSkillStatus: skill.updateStatus,
    deleteSkill: skill.delete,
    listSkillMistakes: skill.mistakes,
    // class
    listClasses: cls.list,
    getClassById: cls.get,
    listClassQa: cls.qa.list,
    askClassQuestion: cls.qa.ask,
    retryClassQa: cls.qa.retry,
    // quiz
    getQuiz: quiz.get,
    submitQuizAnswers: quiz.submit,
    getQuizResult: quiz.result,
    // video
    listSkillRecommendations: video.recommendationsList,
    refreshRecommendations: video.recommendationsRefresh,
    listSponsorSegments: video.sponsorSegments,
    probeYouTubeAccess: video.probe,
    // stats
    getStatsOverview: stats.overview,
    getUsageReport: stats.report,
  };
};
