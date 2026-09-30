import { describe, expect, it } from "vitest";
import {
  makeGetUsageReport,
  type GetUsageReportDeps,
} from "./get-usage-report";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { VectorMetadataRepository } from "@/modules/memory/ports";
import { ok } from "@/modules/platform/result";

const SKILL = {
  id: 10,
  topic: "SQL joins",
  description: "",
  status: "ACTIVE",
  userId: 7,
};
const CHAT = "glm-5.3-flash";
const EMBEDDING = "gemini-embedding-2";

const event = (
  id: number,
  type: "SKILL_CREATED" | "CLASS_GENERATED" | "QA_ANSWERED",
  usage: unknown,
  createdAt: string,
): UsageEventRow => ({
  id,
  type,
  payload: usage === undefined ? {} : { usage },
  skillId: 10,
  createdAt: new Date(createdAt),
});

type UsageEventRow = {
  id: number;
  type: "SKILL_CREATED" | "CLASS_GENERATED" | "QA_ANSWERED";
  payload: Record<string, unknown>;
  skillId: number;
  createdAt: Date;
};

/** Test seam: capturing in-memory ports; rates come from the real table. */
const makeDeps = (
  options: {
    skill?: typeof SKILL | null;
    events?: ReturnType<typeof event>[];
    tokenCounts?: { totalTokens: number; nullCount: number };
  } = {},
) => {
  const state = { askedSkillId: undefined as number | undefined };

  const skillRepo: Pick<SkillRepository, "findById"> = {
    findById: async () => (options.skill === undefined ? SKILL : options.skill),
  };
  const eventRepo: Pick<EventRepository, "findUsageEvents"> = {
    findUsageEvents: async (_userId, skillId) => {
      state.askedSkillId = skillId;
      return options.events ?? [];
    },
  };
  const vectorMetadata: Pick<VectorMetadataRepository, "sumTokenCountsByUser"> = {
    sumTokenCountsByUser: async (_userId, skillId) => {
      state.askedSkillId = skillId;
      return options.tokenCounts ?? { totalTokens: 0, nullCount: 0 };
    },
  };

  const deps: GetUsageReportDeps = {
    skillRepo,
    eventRepo,
    vectorMetadata,
    chatModel: CHAT,
    embeddingModel: EMBEDDING,
  };
  return { deps, state };
};

describe("makeGetUsageReport", () => {
  it("returns zeroed totals and a null window for a user without events", async () => {
    const { deps } = makeDeps();

    const result = await makeGetUsageReport(deps)({ userId: 7 });

    expect(result).toEqual(
      ok({
        totals: {
          promptTokens: 0,
          completionTokens: 0,
          embeddingTokens: 0,
          estimatedCostUsd: 0,
        },
        byKind: {
          skillInit: { events: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
          nextClass: { events: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
          qa: { events: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
        },
        eventsWithoutUsage: 0,
        vectorsWithoutTokenCount: 0,
        window: { from: null, to: null },
      }),
    );
  });

  it("buckets usage by kind and sums the totals", async () => {
    const { deps } = makeDeps({
      events: [
        event(1, "SKILL_CREATED", { promptTokens: 500, completionTokens: 900 }, "2026-09-28T10:00:00Z"),
        event(2, "CLASS_GENERATED", { promptTokens: 700, completionTokens: 1100 }, "2026-09-29T10:00:00Z"),
        event(3, "QA_ANSWERED", { promptTokens: 40, completionTokens: 25 }, "2026-09-30T10:00:00Z"),
      ],
    });

    const result = await makeGetUsageReport(deps)({ userId: 7 });

    if (!result.ok) throw new Error("expected ok");
    expect(result.value.byKind.skillInit).toMatchObject({ events: 1, promptTokens: 500, completionTokens: 900 });
    expect(result.value.byKind.nextClass).toMatchObject({ events: 1, promptTokens: 700, completionTokens: 1100 });
    expect(result.value.byKind.qa).toMatchObject({ events: 1, promptTokens: 40, completionTokens: 25 });
    expect(result.value.totals.promptTokens).toBe(1240);
    expect(result.value.totals.completionTokens).toBe(2025);
    // Chat cost = 1240/1M × $0.6 + 2025/1M × $2.2; embeddings add nothing here.
    expect(result.value.totals.estimatedCostUsd).toBeCloseTo(
      (1240 / 1e6) * 0.6 + (2025 / 1e6) * 2.2,
    );
    expect(result.value.window.from).toEqual(new Date("2026-09-28T10:00:00Z"));
    expect(result.value.window.to).toEqual(new Date("2026-09-30T10:00:00Z"));
  });

  it("counts events without (or with malformed) usage, never costing them", async () => {
    const { deps } = makeDeps({
      events: [
        event(1, "SKILL_CREATED", undefined, "2026-09-28T10:00:00Z"),
        event(2, "CLASS_GENERATED", { promptTokens: "many" }, "2026-09-29T10:00:00Z"),
        event(3, "QA_ANSWERED", { promptTokens: 40 }, "2026-09-30T10:00:00Z"),
      ],
    });

    const result = await makeGetUsageReport(deps)({ userId: 7 });

    if (!result.ok) throw new Error("expected ok");
    expect(result.value.eventsWithoutUsage).toBe(3);
    expect(result.value.totals.promptTokens).toBe(0);
    expect(result.value.byKind.skillInit.events).toBe(1);
    expect(result.value.byKind.skillInit.promptTokens).toBe(0);
  });

  it("adds embedding spend from the token-count aggregate and counts null vectors", async () => {
    const { deps } = makeDeps({
      events: [
        event(1, "SKILL_CREATED", { promptTokens: 1_000_000, completionTokens: 0 }, "2026-09-28T10:00:00Z"),
      ],
      tokenCounts: { totalTokens: 2_000_000, nullCount: 3 },
    });

    const result = await makeGetUsageReport(deps)({ userId: 7 });

    if (!result.ok) throw new Error("expected ok");
    expect(result.value.totals.embeddingTokens).toBe(2_000_000);
    expect(result.value.vectorsWithoutTokenCount).toBe(3);
    // Chat $0.6 + embeddings 2M × $0.15 = $0.30.
    expect(result.value.totals.estimatedCostUsd).toBeCloseTo(0.6 + 0.3);
  });

  it("prices each kind separately with the chat rate", async () => {
    const { deps } = makeDeps({
      events: [
        event(1, "SKILL_CREATED", { promptTokens: 1_000_000, completionTokens: 1_000_000 }, "2026-09-28T10:00:00Z"),
        event(2, "QA_ANSWERED", { promptTokens: 1_000_000, completionTokens: 0 }, "2026-09-29T10:00:00Z"),
      ],
    });

    const result = await makeGetUsageReport(deps)({ userId: 7 });

    if (!result.ok) throw new Error("expected ok");
    expect(result.value.byKind.skillInit.estimatedCostUsd).toBeCloseTo(0.6 + 2.2);
    expect(result.value.byKind.qa.estimatedCostUsd).toBeCloseTo(0.6);
    expect(result.value.byKind.nextClass.estimatedCostUsd).toBe(0);
  });

  it("rejects a skill the user does not own", async () => {
    const { deps } = makeDeps({ skill: { ...SKILL, userId: 99 } });

    const result = await makeGetUsageReport(deps)({ userId: 7, skillId: 10 });

    expect(result).toEqual({ ok: false, error: { kind: "NotOwned", skillId: 10 } });
  });

  it("errors on a missing skill", async () => {
    const { deps } = makeDeps({ skill: null });

    const result = await makeGetUsageReport(deps)({ userId: 7, skillId: 99 });

    expect(result).toEqual({ ok: false, error: { kind: "SkillNotFound", skillId: 99 } });
  });

  it("passes the skill filter to both ports when scoped", async () => {
    const { deps, state } = makeDeps({});

    await makeGetUsageReport(deps)({ userId: 7, skillId: 10 });

    expect(state.askedSkillId).toBe(10);
  });
});
