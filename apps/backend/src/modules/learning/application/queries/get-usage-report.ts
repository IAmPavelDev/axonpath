import { err, ok, type Result } from "@/modules/platform/result";
import type { EventType } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { VectorMetadataRepository } from "@/modules/memory/ports";
import { estimateCostUsd } from "@/modules/learning/domain/event/pricing";

export type GetUsageReportDeps = {
  skillRepo: Pick<SkillRepository, "findById">;
  eventRepo: Pick<EventRepository, "findUsageEvents">;
  vectorMetadata: Pick<VectorMetadataRepository, "sumTokenCountsByUser">;
  chatModel: string;
  embeddingModel: string;
};

export type GetUsageReportInput = {
  userId: number;
  skillId?: number;
};

export type UsageKind = "skillInit" | "nextClass" | "qa";

export type UsageKindSummary = {
  events: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
};

export type UsageReport = {
  totals: {
    promptTokens: number;
    completionTokens: number;
    embeddingTokens: number;
    estimatedCostUsd: number;
  };
  byKind: Record<UsageKind, UsageKindSummary>;
  eventsWithoutUsage: number;
  vectorsWithoutTokenCount: number;
  window: { from: Date | null; to: Date | null };
};

export type GetUsageReportError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number };

/** The container-bound report reader (Result-returning; handlers unwrap). */
export type GetUsageReport = (
  input: GetUsageReportInput,
) => Promise<Result<UsageReport, GetUsageReportError>>;

/** Event kinds that carry chat usage, mapped to their report bucket. */
const KIND_BY_EVENT: Partial<Record<EventType, UsageKind>> = {
  SKILL_CREATED: "skillInit",
  CLASS_GENERATED: "nextClass",
  QA_ANSWERED: "qa",
};

const emptyKind = (): UsageKindSummary => ({
  events: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
});

/**
 * Usage numbers from an event payload — untrusted Json, so every field is
 * re-validated; anything malformed counts as "without usage" rather than
 * contributing a partial sum.
 */
const usageOf = (
  payload: Record<string, unknown>,
): { promptTokens: number; completionTokens: number } | null => {
  const usage = payload.usage;
  if (
    typeof usage === "object" &&
    usage !== null &&
    "promptTokens" in usage &&
    "completionTokens" in usage &&
    typeof usage.promptTokens === "number" &&
    Number.isFinite(usage.promptTokens) &&
    typeof usage.completionTokens === "number" &&
    Number.isFinite(usage.completionTokens)
  ) {
    return {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    };
  }
  return null;
};

/**
 * AI usage & cost for the authenticated user (optionally one skill) — the
 * decision input for "does glm-5.3-flash stay?" (BUSINESS_DECISIONS §4.2).
 * Chat tokens come from the audit events; embedding tokens from the
 * SUM(Vector.tokenCount) aggregate (Step 2 capture). Gaps are counted, never
 * estimated: eventsWithoutUsage / vectorsWithoutTokenCount. Per-user scope —
 * no admin surface.
 */
export const makeGetUsageReport =
  ({
    skillRepo,
    eventRepo,
    vectorMetadata,
    chatModel,
    embeddingModel,
  }: GetUsageReportDeps): GetUsageReport =>
  async (input) => {
    if (input.skillId !== undefined) {
      const skill = await skillRepo.findById(input.skillId);
      if (!skill) {
        return err({ kind: "SkillNotFound", skillId: input.skillId });
      }
      if (skill.userId !== input.userId) {
        return err({ kind: "NotOwned", skillId: input.skillId });
      }
    }

    const [events, vectors] = await Promise.all([
      eventRepo.findUsageEvents(input.userId, input.skillId),
      vectorMetadata.sumTokenCountsByUser(input.userId, input.skillId),
    ]);

    const byKind: Record<UsageKind, UsageKindSummary> = {
      skillInit: emptyKind(),
      nextClass: emptyKind(),
      qa: emptyKind(),
    };
    let promptTokens = 0;
    let completionTokens = 0;
    let eventsWithoutUsage = 0;

    for (const event of events) {
      const kind = KIND_BY_EVENT[event.type];
      if (kind === undefined) {
        continue;
      }
      byKind[kind].events += 1;
      const usage = usageOf(event.payload);
      if (usage === null) {
        eventsWithoutUsage += 1;
        continue;
      }
      byKind[kind].promptTokens += usage.promptTokens;
      byKind[kind].completionTokens += usage.completionTokens;
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
    }

    for (const kind of Object.values(byKind)) {
      kind.estimatedCostUsd = estimateCostUsd(
        chatModel,
        kind.promptTokens,
        kind.completionTokens,
      );
    }

    const chatCost = estimateCostUsd(chatModel, promptTokens, completionTokens);
    const embeddingCost = estimateCostUsd(embeddingModel, vectors.totalTokens, 0);

    return ok({
      totals: {
        promptTokens,
        completionTokens,
        embeddingTokens: vectors.totalTokens,
        estimatedCostUsd: chatCost + embeddingCost,
      },
      byKind,
      eventsWithoutUsage,
      vectorsWithoutTokenCount: vectors.nullCount,
      window: {
        from: events[0]?.createdAt ?? null,
        to: events.at(-1)?.createdAt ?? null,
      },
    });
  };
