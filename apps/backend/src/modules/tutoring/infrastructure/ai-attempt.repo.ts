import { prisma } from "@/modules/platform/infrastructure/prisma";
import { logger } from "@/lib/logger";
import { config } from "@/modules/platform/config";
import { PROMPT_VERSION } from "@/modules/tutoring/domain/prompts";
import { PARSER_VERSION } from "@/modules/tutoring/domain/parse";

export type AiOperation =
  | "init_skill"
  | "skill_description"
  | "next_class"
  | "class_options"
  | "grade_open"
  | "qa_answer";

/**
 * ok = delivered AND parsed into domain data. parse_failed = the model
 * answered but the parser rejected/extracted nothing usable. empty = the
 * answer was structurally valid but carried no work product (e.g. zero
 * questions). transport_error / balance_error = the provider call itself
 * failed (1113 = z.ai account balance exhausted). length_capped is reserved
 * for finish_reason=length outcomes if they ever surface here.
 */
export type AiOutcome =
  | "ok"
  | "parse_failed"
  | "empty"
  | "length_capped"
  | "transport_error"
  | "balance_error";

/** Injected seam — use-case tests pass a no-op instead of the Prisma writer. */
export type RecordAiAttempt = (input: AiAttemptInput) => void;

export type AiAttemptInput = {
  userId?: number | null;
  operation: AiOperation;
  /** 1-based within one operation invocation; default 1. */
  attempt?: number;
  outcome: AiOutcome;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  rawChars?: number | null;
  errorKind?: string | null;
};

const errorKindOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
};

/**
 * Fire-and-forget metrics write — the same contract as the learning audit
 * event: analytics must never gate the learner flow, so failures only warn.
 */
export const recordAiAttempt = (input: AiAttemptInput): void => {
  prisma.aiAttempt
    .create({
      data: {
        userId: input.userId ?? null,
        operation: input.operation,
        attempt: input.attempt ?? 1,
        outcome: input.outcome,
        model: config.ai.models.chat,
        latencyMs: Math.round(input.latencyMs),
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        rawChars: input.rawChars ?? null,
        promptVersion: PROMPT_VERSION,
        parserVersion: PARSER_VERSION,
        errorKind: input.errorKind ?? null,
      },
    })
    .catch((err: unknown) => {
      logger.warn(
        { err, operation: input.operation },
        "Failed to record AI attempt",
      );
    });
};

/**
 * Map a thrown/failed generation error to (outcome, errorKind). z.ai dies
 * with exit code 1113 in the message when the account balance runs out —
 * worth its own outcome because it means "not the prompt's fault".
 */
export const outcomeForError = (error: unknown): {
  outcome: AiOutcome;
  errorKind: string;
} => {
  const errorKind = errorKindOf(error);
  return {
    outcome: messageIncludes1113(error) ? "balance_error" : "transport_error",
    errorKind,
  };
};

const messageIncludes1113 = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("1113");
};
