import {
  generationFailed,
  generationSkipped,
  generationStarted,
  generationSucceeded,
} from "@/lib/generation-logger";
import { logger } from "@/lib/logger";

import type { AiPort } from "@/modules/tutoring/ports";
import { extractJsonObject } from "@/modules/tutoring/domain/parse";
import type { GeminiVideoClient } from "@/modules/video/infrastructure/gemini-video.client";
import { clampClipWindow } from "@/modules/video/domain/video-enrichment";
import type {
  NewClassClip,
  VideoRepository,
} from "@/modules/video/domain/video-repos";
import type { YouTubeScraperPort } from "@/modules/video/domain/youtube-access";

export const CLASS_VIDEO_CLIPS_JOB = "class-video-clips";

export type GenerateClassClips = (input: { classId: number }) => Promise<void>;

export type GenerateClassClipsDeps = {
  videoRepo: VideoRepository;
  search: Pick<YouTubeScraperPort, "searchYouTube">;
  ai: Pick<AiPort, "generateJson">;
  gemini: GeminiVideoClient;
  maxConcepts?: number;
  candidatesPerConcept?: number;
};

const PLAN_SYSTEM =
  "You decide whether embedding a short YouTube segment would genuinely improve a lesson. Reply with JSON only.";

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    helps: { type: "boolean" },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          anchorParagraph: { type: "integer" },
        },
        required: ["query", "anchorParagraph"],
      },
    },
  },
  required: ["helps", "concepts"],
};

type ParsedConcept = { query?: unknown; anchorParagraph?: unknown };
type ParsedPlan = { helps?: unknown; concepts?: unknown };

/** Lesson markdown window handed to the planner — bounded, never the tail. */
const PLAN_CONTENT_CHARS = 8000;
/** Candidate duration sanity: real explanations, not shorts or streams. */
const MIN_CANDIDATE_SECONDS = 120;
const MAX_CANDIDATE_SECONDS = 3600;

/**
 * Lesson (class) video clips: the model decides per class whether a video
 * would improve it; for at most `maxConcepts` concepts it picks the best
 * candidate video and Gemini selects the exact teaching segment. Silent on
 * failure: the sweeper retries within the attempts budget, and the final
 * give-up flips the class to SKIPPED — the lesson then renders with no hint
 * that videos were ever intended.
 */
export const makeGenerateClassClips =
  ({
    videoRepo,
    search,
    ai,
    gemini,
    maxConcepts = 2,
    candidatesPerConcept = 2,
  }: GenerateClassClipsDeps) =>
  async (input: { classId: number }): Promise<void> => {
    const pipelineStartedAt = Date.now();
    const klass = await videoRepo.findClassForClips(input.classId);
    if (!klass) {
      generationSkipped(
        { pipeline: "class_clips", classId: input.classId },
        { durationMs: Date.now() - pipelineStartedAt, reason: "class deleted mid-enrichment" },
      );
      return;
    }
    const logCtx = {
      pipeline: "class_clips",
      classId: input.classId,
      className: klass.title,
      skillName: klass.skillTopic,
    } as const;
    generationStarted(logCtx);

    const planResult = await ai.generateJson(
      {
        system: PLAN_SYSTEM,
        prompt: [
          `Lesson title: "${klass.title}" (part of a course on "${klass.skillTopic}").`,
          ...(klass.baseLanguage
            ? [
                `The lesson is written in ${klass.baseLanguage} (BCP-47); the videos`,
                "must teach in that same language — phrase the search queries in it.",
              ]
            : []),
          "Lesson content:",
          klass.contentMd.slice(0, PLAN_CONTENT_CHARS),
          "",
          "Would 1-2 short video segments (1-6 min) make this lesson meaningfully better?",
          "Visual demonstrations, animations and spoken explanations qualify; plain",
          "restatements of the text do not. If yes, give at most 2 concrete concepts with",
          "focused YouTube search queries and the zero-based conspect block index each",
          'concept belongs after. Answer JSON: {"helps": boolean, "concepts": [...]}',
        ].join("\n"),
      },
      {
        schemaName: "class-video-plan",
        responseSchema: PLAN_SCHEMA as Record<string, unknown>,
      },
    );
    if (!planResult.ok) {
      generationFailed(
        logCtx,
        {
          durationMs: Date.now() - pipelineStartedAt,
          errorKind: planResult.error.kind,
          errorDetail: planResult.error.detail,
        },
      );
      return; // planner failed — sweeper retries within budget
    }

    const plan = extractJsonObject(planResult.value.raw) as ParsedPlan | null;
    const rawConcepts = Array.isArray(plan?.concepts) ? plan.concepts : [];
    const concepts = rawConcepts
      .map((concept: ParsedConcept) => ({
        query: typeof concept.query === "string" ? concept.query : "",
        anchorParagraph:
          typeof concept.anchorParagraph === "number" && concept.anchorParagraph >= 0
            ? Math.floor(concept.anchorParagraph)
            : 0,
      }))
      .filter((concept) => concept.query.length > 0)
      .slice(0, maxConcepts ?? 2);

    logger.info(
      {
        ...logCtx,
        helps: plan?.helps === true,
        concepts: concepts.map((concept) => concept.query),
      },
      "class_clips.plan",
    );

    if (plan?.helps !== true || concepts.length === 0) {
      generationSkipped(
        logCtx,
        {
          durationMs: Date.now() - pipelineStartedAt,
          reason: "model decided videos would not help this lesson",
        },
      );
      await videoRepo.setClipStatus(input.classId, "SKIPPED");
      return;
    }

    const clips: NewClassClip[] = [];
    for (const concept of concepts) {
      const searchResult = await search.searchYouTube(concept.query, {
        innertubeApiKey: null,
        innertubeClientVersion: null,
      });
      if (!searchResult.ok) {
        logger.warn(
          {
            ...logCtx,
            concept: concept.query,
            errorKind: searchResult.error.kind,
            detail: searchResult.error.detail,
          },
          "class_clips.search_failed",
        );
        continue;
      }
      const candidates = searchResult.value
        .filter(
          (hit) =>
            (hit.durationSeconds ?? 0) >= MIN_CANDIDATE_SECONDS &&
            (hit.durationSeconds ?? 0) <= MAX_CANDIDATE_SECONDS,
        )
        .slice(0, candidatesPerConcept ?? 2);
      logger.info(
        {
          ...logCtx,
          concept: concept.query,
          hits: searchResult.value.length,
          candidates: candidates.map((candidate) => ({
            videoId: candidate.videoId,
            durationSeconds: candidate.durationSeconds,
          })),
        },
        "class_clips.candidates",
      );

      for (const candidate of candidates) {
        await videoRepo.upsertVideoAsset({
          videoId: candidate.videoId,
          title: candidate.title,
          channel: candidate.channel,
          durationSeconds: candidate.durationSeconds,
        });
        const selection = await gemini.selectClipSegment({
          videoId: candidate.videoId,
          concept: concept.query,
          lessonTitle: klass.title,
          language: klass.baseLanguage,
        });
        if (!selection.ok) {
          logger.warn(
            {
              ...logCtx,
              concept: concept.query,
              videoId: candidate.videoId,
              errorKind: selection.error.kind,
              detail: selection.error.detail,
              httpStatus: selection.error.httpStatus,
            },
            "class_clips.segment_selection_failed",
          );
          continue;
        }
        if (!selection.value.found) {
          logger.info(
            { ...logCtx, concept: concept.query, videoId: candidate.videoId },
            "class_clips.segment_not_found",
          );
          continue;
        }
        const window = clampClipWindow(
          selection.value.startSeconds,
          selection.value.endSeconds,
          candidate.durationSeconds,
        );
        if (!window) {
          logger.info(
            {
              ...logCtx,
              videoId: candidate.videoId,
              startSeconds: selection.value.startSeconds,
              endSeconds: selection.value.endSeconds,
              durationSeconds: candidate.durationSeconds,
            },
            "class_clips.clip_window_rejected",
          );
          continue;
        }
        clips.push({
          anchorParagraph: concept.anchorParagraph,
          videoId: candidate.videoId,
          title: candidate.title,
          channel: candidate.channel,
          startSeconds: window.startSeconds,
          endSeconds: window.endSeconds,
          transcriptExcerpt: selection.value.summary || null,
          concept: concept.query,
        });
        break; // one clip per concept — the first complete explanation wins
      }
    }

    if (clips.length === 0) {
      // Nothing usable surfaced this pass — leave PENDING so the sweeper can
      // retry; the attempts budget turns it SKIPPED silently in the end.
      generationSkipped(
        logCtx,
        {
          durationMs: Date.now() - pipelineStartedAt,
          reason: "no usable video clips surfaced; leaving PENDING for retry",
        },
      );
      return;
    }
    await videoRepo.replaceClassClips(input.classId, clips);
    await videoRepo.setClipStatus(input.classId, "READY");
    generationSucceeded(
      logCtx,
      { durationMs: Date.now() - pipelineStartedAt, count: clips.length },
    );
  };
