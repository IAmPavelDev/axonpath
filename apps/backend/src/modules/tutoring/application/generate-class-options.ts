import { EventType, NextClassOptionsState, SkillStatus } from "@/prisma/generated";
import { err, ok, type Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import {
  buildClassOptionsPrompt,
  CLASS_OPTIONS_SCHEMA,
} from "@/modules/tutoring/domain/prompts";
import { OPTIONS_SYSTEM } from "@/modules/tutoring/domain/personas";
import { extractJsonObject } from "@/modules/tutoring/domain/parse";
import type { Clock } from "@/modules/platform/ports/clock";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type {
  NextClassOptionRepository,
} from "@/modules/learning/domain/skill/next-class-option.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type {
  QuizRepository,
} from "@/modules/learning/domain/quiz/quiz.repository";
import { selectReviewItems } from "@/modules/learning/domain/quiz/review-schedule";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";

/** Enqueued when a MANUAL skill needs a fresh candidate set (see triggers). */
export const SKILL_CLASS_OPTIONS_JOB = "skill-class-options";

export type SkillClassOptionsJobPayload = {
  skillId: number;
  userId: number;
};

export type GenerateClassOptionsError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "AiGenerationFailed"; detail?: string }
  | { kind: "AiResponseInvalid"; detail?: string };

export type GenerateClassOptionsDeps = {
  ai: AiPort;
  /** Same retrieval seam generate-next-class uses; degrades to [] itself. */
  retrieveContext: (input: {
    userId: number;
    query: string;
    topK?: number;
  }) => Promise<{ textSnippet: string; source: string; classIndex: number | null }[]>;
  skillRepo: SkillRepository;
  optionRepo: NextClassOptionRepository;
  classRepo: ClassRepository;
  quizRepo: QuizRepository;
  eventRepo: EventRepository;
  clock: Clock;
};

export type GenerateClassOptions = (
  input: SkillClassOptionsJobPayload,
) => Promise<Result<void, GenerateClassOptionsError>>;

/**
 * The MANUAL-mode candidate generator: one AI request proposing exactly three
 * ranked directions for the skill's next lesson, persisted as the skill's
 * candidate set (state READY). Triggers set state PENDING before enqueueing:
 * create-skill (MANUAL), submit-quiz completing the newest lesson (MANUAL),
 * skill.setMode to MANUAL, and skill.refreshClassOptions.
 *
 * Gates: only an ACTIVE skill generates. Any other status is a stale signal
 * (paused mid-flight, mode flipped away) — the pipeline no-ops and rewinds a
 * dangling PENDING to NONE, mirroring generate-next-class's pause gate.
 * Failure flips state FAILED (the client offers a refresh) and records
 * ERROR_OCCURRED. The job is intentionally not durable — a lost attempt
 * costs the client one refresh tap, not data.
 */
export const makeGenerateClassOptions =
  ({
    ai,
    retrieveContext,
    skillRepo,
    optionRepo,
    classRepo,
    quizRepo,
    eventRepo,
    clock,
  }: GenerateClassOptionsDeps): GenerateClassOptions =>
  async (input) => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }

    if (skill.status !== SkillStatus.ACTIVE) {
      if (skill.optionsState === NextClassOptionsState.PENDING) {
        await skillRepo.update(input.skillId, {
          optionsState: NextClassOptionsState.NONE,
          optionsStateAt: null,
        });
      }
      return ok(undefined);
    }

    const last = await classRepo.findTopBySkill(input.skillId);

    // One retrieval call for the history blocks (own skill's memory wanted —
    // no excludeSkillId); degrades to [] on failure, like next-class.
    const history = last
      ? await retrieveContext({
          userId: input.userId,
          query: `${skill.topic} ${last.title}`,
          topK: 12,
        })
      : [];

    // Mastery ledger across the whole skill: candidates should reflect what
    // needs consolidation, not just the last lesson.
    const review = selectReviewItems(
      await quizRepo.findReviewCandidatesBySkill(input.skillId, input.userId),
      { topClassIndex: last?.index ?? null, now: clock.now() },
    );

    const lastSummaryHit = last
      ? history.find(
          (hit) => hit.source === "AI_NEXT" && hit.classIndex === last.index,
        )
      : undefined;

    const prompt = buildClassOptionsPrompt({
      topic: skill.topic,
      lastTitle: last?.title,
      lastSummary: lastSummaryHit?.textSnippet,
      history: lastSummaryHit
        ? history.filter((hit) => hit !== lastSummaryHit)
        : history,
      review,
    });

    const generation = await ai.generateJson(
      { system: OPTIONS_SYSTEM, prompt },
      { schemaName: "class_options", responseSchema: CLASS_OPTIONS_SCHEMA },
    );

    const failureState = {
      optionsState: NextClassOptionsState.FAILED,
      optionsStateAt: clock.now(),
    };

    if (!generation.ok) {
      await skillRepo.update(input.skillId, failureState);
      await eventRepo.record({
        skillId: input.skillId,
        userId: input.userId,
        type: EventType.ERROR_OCCURRED,
        payload: {
          action: "class_options",
          prompt,
          system: OPTIONS_SYSTEM,
          error: generation.error,
        },
      });
      return { ok: false, error: generation.error };
    }

    // Untrusted model output: keep only non-empty string targets, capped at
    // 3 (rank follows response order). An empty set degrades to FAILED.
    let targets: string[] = [];
    try {
      const parsed = extractJsonObject(generation.value.raw) as {
        targets?: unknown;
      };
      targets = (Array.isArray(parsed.targets) ? parsed.targets : [])
        .filter((target): target is string => typeof target === "string")
        .map((target) => target.trim())
        .filter((target) => target.length > 0)
        .slice(0, 3);
    } catch {
      targets = [];
    }

    if (targets.length === 0) {
      const error = {
        kind: "AiResponseInvalid",
        detail: "no valid targets in response",
      } as const;
      await skillRepo.update(input.skillId, failureState);
      await eventRepo.record({
        skillId: input.skillId,
        userId: input.userId,
        type: EventType.ERROR_OCCURRED,
        payload: {
          action: "class_options",
          prompt,
          system: OPTIONS_SYSTEM,
          response: generation.value.raw,
          error,
        },
      });
      return { ok: false, error };
    }

    await optionRepo.replaceForSkill(
      input.skillId,
      targets.map((text, i) => ({ rank: i + 1, text })),
    );
    await skillRepo.update(input.skillId, {
      optionsState: NextClassOptionsState.READY,
      optionsStateAt: clock.now(),
    });

    // Audit with the full request + response for debugging (usage.report
    // reads the usage payload under the classOptions kind).
    await eventRepo.record({
      skillId: input.skillId,
      userId: input.userId,
      type: EventType.CLASS_OPTIONS_GENERATED,
      payload: {
        action: "class_options",
        prompt,
        system: OPTIONS_SYSTEM,
        usage: generation.value.usage,
        response: generation.value.raw,
      },
    });

    return ok(undefined);
  };
