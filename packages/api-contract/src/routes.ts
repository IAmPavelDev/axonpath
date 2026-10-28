import z from "zod";
import * as auth from "./schema/auth.schema.js";
import * as skill from "./schema/skill.schema.js";
import * as cls from "./schema/class.schema.js";
import * as quiz from "./schema/quiz.schema.js";
import * as stats from "./schema/stats.schema.js";
import * as video from "./schema/video.schema.js";

/**
 * The single place where method + path + schemas meet (migration D3).
 * The backend Fastify registration (`apps/backend/src/lib/routes.ts`) and the
 * OpenAPI emitter (`src/emit-openapi.ts`) both consume this table — a path
 * string exists in exactly one place.
 *
 * Conventions:
 * - `path` uses OpenAPI `{param}` placeholders; the placeholder name always
 *   matches the zod input field name, so the parsed handler input keeps the
 *   same shape the handlers received under the previous transport.
 * - Each route carries exactly one tag (its API family). openapi-generator
 *   creates one API class per tag — multi-tag routes would be emitted into
 *   several classes (P0 finding).
 * - Fields are picked/derived from the schema files, never restated. Id
 *   fields whose schema is a bare `z.number()` are refined with `.int()` for
 *   the transport: ids are integer primary keys, and `type: number` maps to
 *   `java.math.BigDecimal` in the generated Kotlin client (P0 finding).
 */

export type ApiMethod = "GET" | "POST" | "DELETE";

export type RouteDef = {
  /** operationId — also the handler lookup key on the backend. */
  id: string;
  method: ApiMethod;
  /** OpenAPI-style path, e.g. "/skill/{id}". */
  path: string;
  summary: string;
  /** Exactly one tag per route: openapi-generator groups API classes by it. */
  tag: string;
  params?: z.ZodType; // object of path params
  query?: z.ZodType; // object of query params
  body?: z.ZodType; // JSON body
  response: z.ZodType; // success body
};

export const ROUTES: RouteDef[] = [
  {
    id: "getMe",
    method: "GET",
    path: "/auth/me",
    summary: "Get the authenticated user profile",
    tag: "Auth",
    response: auth.MeOutput,
  },

  {
    id: "listSkills",
    method: "GET",
    path: "/skill/list",
    summary: "List skills (archived excluded unless included)",
    tag: "Skill",
    query: skill.GetSkillListInput.unwrap(),
    response: skill.GetSkillListOutput,
  },
  {
    id: "createSkill",
    method: "POST",
    path: "/skill/create",
    summary: "Create a skill from a freeform learning brief",
    tag: "Skill",
    body: skill.CreateSkillInput,
    response: skill.CreateSkillOutput,
  },
  {
    id: "getSkillById",
    method: "GET",
    path: "/skill/{id}",
    summary: "Get skill by id",
    tag: "Skill",
    params: skill.SkillIdInput,
    response: skill.GetSkillByIdOutput,
  },
  {
    id: "editSkill",
    method: "POST",
    path: "/skill/{id}/edit",
    summary: "Edit skill topic/description",
    tag: "Skill",
    params: skill.SkillIdInput,
    body: skill.EditSkillInput.pick({ topic: true, description: true }),
    response: skill.StatusOnly,
  },
  {
    id: "retrySkill",
    method: "POST",
    path: "/skill/{id}/retry",
    summary: "Retry a failed skill generation",
    tag: "Skill",
    params: skill.SkillIdInput,
    response: skill.StatusOnly,
  },
  {
    id: "getSkillProgress",
    method: "GET",
    path: "/skill/{id}/progress",
    summary: "Per-class progress for a skill",
    tag: "Skill",
    params: skill.SkillIdInput,
    response: skill.SkillProgressOutput,
  },
  {
    id: "updateSkillStatus",
    method: "POST",
    path: "/skill/{id}/status",
    summary: "Set user-owned skill lifecycle status",
    tag: "Skill",
    params: skill.SkillIdInput,
    body: skill.UpdateSkillStatusInput.pick({ status: true }),
    response: skill.StatusOnly,
  },
  {
    id: "deleteSkill",
    method: "DELETE",
    path: "/skill/{id}",
    summary: "Delete a skill and its classes",
    tag: "Skill",
    params: skill.SkillIdInput,
    response: skill.DeleteSkillOutput,
  },
  {
    id: "listSkillMistakes",
    method: "GET",
    path: "/skill/{id}/mistakes",
    summary: "Latest wrong answer per question, newest first",
    tag: "Skill",
    params: skill.SkillIdInput,
    response: skill.SkillMistakesOutput,
  },

  {
    id: "listClasses",
    method: "GET",
    path: "/class/list",
    summary: "List classes of a skill",
    tag: "Class",
    query: z.object({ skillId: cls.GetClassListInput.shape.skillId.int() }),
    response: cls.GetClassListOutput,
  },
  {
    id: "getClassById",
    method: "GET",
    path: "/class/{id}",
    summary: "Get class by id",
    tag: "Class",
    params: z.object({ id: cls.GetClassByIdInput.shape.id.int() }),
    response: cls.GetClassByIdOutput,
  },
  {
    id: "listClassQa",
    method: "GET",
    path: "/class/qa/list",
    summary: "List Q&A blocks for a class, ordered by anchor",
    tag: "Class",
    query: z.object({ classId: cls.ListClassQaInput.shape.classId.int() }),
    response: cls.ListClassQaOutput,
  },
  {
    id: "askClassQuestion",
    method: "POST",
    path: "/class/qa/ask",
    summary: "Ask a question anchored in the class conspect",
    tag: "Class",
    body: cls.AskClassQuestionInput,
    response: cls.AskClassQuestionOutput,
  },
  {
    id: "retryClassQa",
    method: "POST",
    path: "/class/qa/retry",
    summary: "Restart a failed Q&A block in place (same id, same anchor)",
    tag: "Class",
    body: cls.RetryClassQaInput,
    response: cls.AskClassQuestionOutput,
  },

  {
    id: "getQuiz",
    method: "GET",
    path: "/quiz/{classId}",
    summary: "Get quiz by id",
    tag: "Quiz",
    params: z.object({ classId: quiz.GetQuizByClassIdInput.shape.classId.int() }),
    response: quiz.GetQuizByClassIdOutput,
  },
  {
    id: "submitQuizAnswers",
    method: "POST",
    path: "/quiz/{classId}/submit",
    summary: "Submit quiz answers",
    tag: "Quiz",
    params: z.object({ classId: quiz.SubmitQuizAnswersInput.shape.classId.int() }),
    body: quiz.SubmitQuizAnswersInput.pick({ answers: true }),
    response: quiz.SubmitQuizAnswersOutput,
  },
  {
    id: "getQuizResult",
    method: "GET",
    path: "/quiz/{classId}/result",
    summary: "Get the learner's latest quiz attempt for a class",
    tag: "Quiz",
    params: z.object({ classId: quiz.GetQuizResultInput.shape.classId.int() }),
    response: quiz.GetQuizResultOutput,
  },

  {
    id: "listSkillRecommendations",
    method: "GET",
    path: "/video/recommendations/list",
    summary: "Top-10 whole-video recommendations for a skill (PENDING while generating)",
    tag: "Video",
    query: video.SkillRecommendationsInput,
    response: video.SkillRecommendationsOutput,
  },
  {
    id: "refreshRecommendations",
    method: "POST",
    path: "/video/recommendations/refresh",
    summary: "Re-run recommendations generation for a skill",
    tag: "Video",
    body: video.RefreshRecommendationsInput,
    response: video.RefreshRecommendationsOutput,
  },
  {
    id: "listSponsorSegments",
    method: "GET",
    path: "/video/sponsor-segments",
    summary: "SponsorBlock community skip segments (sponsor/selfpromo/interaction) for a video",
    tag: "Video",
    query: video.SponsorSegmentsInput,
    response: video.SponsorSegmentsOutput,
  },
  {
    id: "probeYouTubeAccess",
    method: "POST",
    path: "/video/probe",
    summary: "Probe unofficial YouTube access paths (InnerTube search, watch page, transcript) from the current runtime",
    tag: "Video",
    body: video.ProbeYouTubeAccessInput,
    response: video.ProbeYouTubeAccessOutput,
  },

  {
    id: "getStatsOverview",
    method: "GET",
    path: "/stats/overview",
    summary: "Learning stats: streak, weekly activity, per-skill totals",
    tag: "Stats",
    response: stats.StatsOverviewOutput,
  },
  {
    id: "getUsageReport",
    method: "GET",
    path: "/usage/report",
    summary: "AI token usage and estimated cost (per user, optionally per skill)",
    tag: "Stats",
    query: stats.UsageReportInput.unwrap(),
    response: stats.UsageReportOutput,
  },
];
