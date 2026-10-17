import { logger } from "@/lib/logger";

/**
 * Structured logging for the long-running generation pipelines (next_class,
 * skill_init, class_options, recommendations, class_clips). Every run posts
 * exactly one `generation.started` and one closing line — `generation.succeeded`,
 * `generation.skipped` (benign no-op: dedup, pause gate, "videos don't help")
 * or `generation.failed` (level 50, feeds the Axon/Backend Errors metric) —
 * with ids AND human names so a CloudWatch line identifies the run without
 * cross-referencing the database.
 */
export type GenerationPipeline =
  | "skill_metadata"
  | "skill_first_lesson"
  | "next_class"
  | "recommendations"
  | "class_clips";

export type GenerationContext = {
  pipeline: GenerationPipeline;
  skillId?: number;
  skillName?: string;
  userId?: number;
  classId?: number;
  className?: string;
};

export const generationStarted = (ctx: GenerationContext): void => {
  logger.info({ ...ctx }, "generation.started");
};

export const generationSucceeded = (
  ctx: GenerationContext,
  detail: { durationMs: number; classId?: number; className?: string; count?: number },
): void => {
  logger.info({ ...ctx, ...detail, status: "success" }, "generation.succeeded");
};

/** Benign no-op exit: dedup, gate, or "generation not applicable". Info level. */
export const generationSkipped = (
  ctx: GenerationContext,
  detail: { durationMs: number; reason: string },
): void => {
  logger.info({ ...ctx, ...detail, status: "skipped" }, "generation.skipped");
};

export const generationFailed = (
  ctx: GenerationContext,
  detail: {
    durationMs: number;
    errorKind: string;
    errorDetail?: string;
    attempt?: number;
    maxAttempts?: number;
  },
): void => {
  logger.error({ ...ctx, ...detail, status: "failed" }, "generation.failed");
};
