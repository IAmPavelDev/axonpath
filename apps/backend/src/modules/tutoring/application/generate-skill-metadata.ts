import {
  generationFailed,
  generationStarted,
  generationSucceeded,
} from "@/lib/generation-logger";

import { EventType, SkillStatus } from "@/prisma/generated";
import type { Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import {
  buildSkillMetadataPrompt,
  SKILL_METADATA_SCHEMA,
} from "@/modules/tutoring/domain/prompts";
import { METADATA_SYSTEM } from "@/modules/tutoring/domain/personas";
import { extractJsonObject } from "@/modules/tutoring/domain/parse";
import {
  outcomeForError,
  type RecordAiAttempt,
} from "@/modules/tutoring/infrastructure/ai-attempt.repo";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";

/** Skill.topic column width — the generated title must fit it. */
export const SKILL_TITLE_MAX = 255;

export type GenerateSkillMetadataError =
  | { kind: "AiGenerationFailed"; detail?: string }
  | { kind: "AiResponseInvalid"; detail?: string };

export type GenerateSkillMetadataDeps = {
  ai: AiPort;
  recordAiAttempt: RecordAiAttempt;
  skillRepo: SkillRepository;
  eventRepo: EventRepository;
  chatModel: string;
};

export type GenerateSkillMetadataInput = {
  skillId: number;
  userId: number;
  /** The learner's original freeform brief, stored on the skill row. */
  prompt: string;
};

/** The bound, dependency-complete use case — what the job registry consumes. */
export type GenerateSkillMetadata = (
  input: GenerateSkillMetadataInput,
) => Promise<Result<void, GenerateSkillMetadataError>>;

/**
 * Stage 1 of the create-with-prompt flow (the "skill-init" job): one AI call
 * turns the learner's freeform prompt into the skill's title + description
 * and persists both. Success settles the skill ACTIVE with zero classes —
 * the client then shows the draft for review, and its acceptance (skill.edit
 * on a lesson-less ACTIVE skill) arms the "skill-first-lesson" job. Any
 * failure settles FAILED; skill.retry re-enters this pipeline from the
 * stored prompt.
 */
export const makeGenerateSkillMetadata =
  ({
    recordAiAttempt,
    ai,
    skillRepo,
    eventRepo,
    chatModel,
  }: GenerateSkillMetadataDeps): GenerateSkillMetadata =>
  async (input) => {
    const logCtx = {
      pipeline: "skill_metadata",
      skillId: input.skillId,
      skillName: input.prompt.slice(0, 120),
      userId: input.userId,
    } as const;
    generationStarted(logCtx);
    const startedAt = Date.now();

    // Every error exit funnels here: settle FAILED + audit so the skill
    // never hangs in GENERATING (retry re-enters from the stored prompt).
    const fail = async (
      error: GenerateSkillMetadataError,
      attempt?: {
        outcome: "parse_failed" | "empty";
        rawChars: number;
        errorKind: string;
      },
    ): Promise<Result<void, GenerateSkillMetadataError>> => {
      if (attempt) {
        recordAiAttempt({
          userId: input.userId,
          operation: "skill_metadata",
          outcome: attempt.outcome,
          latencyMs: Date.now() - startedAt,
          rawChars: attempt.rawChars,
          errorKind: attempt.errorKind,
        });
      }
      await skillRepo.update(input.skillId, { status: SkillStatus.FAILED });
      generationFailed(logCtx, {
        durationMs: Date.now() - startedAt,
        errorKind: error.kind,
        errorDetail: error.detail,
      });
      await eventRepo.record({
        skillId: input.skillId,
        userId: input.userId,
        type: EventType.ERROR_OCCURRED,
        payload: { action: "skill_metadata", error },
      });
      return { ok: false, error };
    };

    const generation = await ai.generateJson(
      {
        system: METADATA_SYSTEM,
        prompt: buildSkillMetadataPrompt(input.prompt),
      },
      { schemaName: "skill_metadata", responseSchema: SKILL_METADATA_SCHEMA },
    );

    if (!generation.ok) {
      recordAiAttempt({
        userId: input.userId,
        operation: "skill_metadata",
        ...outcomeForError(generation.error),
        latencyMs: Date.now() - startedAt,
      });
      return await fail(generation.error);
    }

    // Named cast: untrusted model output; every field re-validated below.
    let parsed: { title?: unknown; description?: unknown };
    try {
      parsed = extractJsonObject(generation.value.raw) as typeof parsed;
    } catch (error) {
      // glm-5.3-flash sometimes answers prose despite the JSON schema; with
      // two required fields there is no prose fallback — parse failure.
      return await fail(
        {
          kind: "AiResponseInvalid",
          detail: error instanceof Error ? error.message : String(error),
        },
        {
          outcome: "parse_failed",
          rawChars: generation.value.raw.length,
          errorKind: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const description =
      typeof parsed.description === "string" ? parsed.description.trim() : "";
    if (title.length === 0 || description.length === 0) {
      return await fail(
        {
          kind: "AiResponseInvalid",
          detail: "model returned an empty title or description",
        },
        {
          outcome: "empty",
          rawChars: generation.value.raw.length,
          errorKind: "model returned an empty title or description",
        },
      );
    }

    recordAiAttempt({
      userId: input.userId,
      operation: "skill_metadata",
      outcome: "ok",
      latencyMs: Date.now() - startedAt,
      promptTokens: generation.value.usage?.promptTokens,
      completionTokens: generation.value.usage?.completionTokens,
      rawChars: generation.value.raw.length,
    });

    // Audit SKILL_CREATED with the full request + response for debugging;
    // the usage report reads the skillInit cost bucket from this event.
    await eventRepo.record({
      skillId: input.skillId,
      userId: input.userId,
      type: EventType.SKILL_CREATED,
      payload: {
        action: "skill_metadata",
        prompt: buildSkillMetadataPrompt(input.prompt),
        system: METADATA_SYSTEM,
        model: chatModel,
        usage: generation.value.usage,
        response: generation.value.raw,
      },
    });

    await skillRepo.update(input.skillId, {
      topic: title.slice(0, SKILL_TITLE_MAX),
      description,
      status: SkillStatus.ACTIVE,
    });

    generationSucceeded(logCtx, { durationMs: Date.now() - startedAt });
    return { ok: true, value: undefined };
  };
