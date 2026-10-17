import { describe, expect, it } from "vitest";
import {
  makeGenerateSkillMetadata,
  type GenerateSkillMetadataDeps,
} from "./generate-skill-metadata";
import { EventType, SkillStatus } from "@/prisma/generated";
import type { AiError, AiUsage } from "@/modules/tutoring/ports";
import type { DomainEvent } from "@/modules/learning/domain/event/event.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import { ok } from "@/modules/platform/result";

const METADATA_OK = JSON.stringify({
  title: "SQL Joins",
  description: "Learn SQL joins by doing.",
});

/** Test seam: scripted AiPort + in-memory skill repo/event log capturing
 * every update and audit. */
const makeDeps = (overrides: {
  raw?: string;
  error?: AiError;
  usage?: AiUsage;
  failParse?: boolean;
} = {}) => {
  const state = {
    skillUpdates: [] as { id: number; patch: Record<string, unknown> }[],
    events: [] as DomainEvent[],
    aiCalls: [] as { schemaName: string; prompt: string }[],
    attempts: [] as { outcome: string; errorKind?: string | null }[],
  };

  const deps: GenerateSkillMetadataDeps = {
    recordAiAttempt: (input) => {
      state.attempts.push({ outcome: input.outcome, errorKind: input.errorKind });
    },
    ai: {
      generateJson: async (input, request) => {
        state.aiCalls.push({ schemaName: request.schemaName, prompt: input.prompt });
        if (overrides.error) {
          return { ok: false, error: overrides.error };
        }
        const raw =
          overrides.failParse === true
            ? "prose answer, not JSON at all"
            : (overrides.raw ?? METADATA_OK);
        return ok({ raw, usage: overrides.usage });
      },
      generateText: async () => {
        throw new Error("generateText not used in metadata tests");
      },
      generateEmbeddings: async () => {
        throw new Error("generateEmbeddings not used in metadata tests");
      },
    },
    skillRepo: {
      create: async () => {
        throw new Error("create not used in metadata tests");
      },
      update: async (id, patch) => {
        state.skillUpdates.push({ id, patch: { ...patch } });
        return { id, topic: "SQL Joins", description: "d", status: "ACTIVE" };
      },
      findById: async () => null,
      listByUser: async () => [],
      listByStatus: async () => [],
      settleStaleGenerating: async () => [],
      claimStaleInit: async () => [],
      claimStaleFirstLesson: async () => [],
    } satisfies SkillRepository,
    eventRepo: {
      findUsageEvents: async () => [],
      record: async (event) => {
        state.events.push(event);
      },
    },
    chatModel: "glm-5.3-flash",
  };

  return { deps, state };
};

const INPUT = {
  skillId: 10,
  userId: 1,
  prompt: "I want to learn SQL joins for work.",
};

describe("makeGenerateSkillMetadata", () => {
  it("persists the generated title + description and settles ACTIVE in one update", async () => {
    const { deps, state } = makeDeps();

    const result = await makeGenerateSkillMetadata(deps)(INPUT);

    expect(result.ok).toBe(true);
    expect(state.skillUpdates).toEqual([
      {
        id: 10,
        patch: {
          topic: "SQL Joins",
          description: "Learn SQL joins by doing.",
          status: SkillStatus.ACTIVE,
        },
      },
    ]);
  });

  it("fences the learner prompt and requests the skill_metadata schema", async () => {
    const { deps, state } = makeDeps();

    await makeGenerateSkillMetadata(deps)(INPUT);

    expect(state.aiCalls).toHaveLength(1);
    expect(state.aiCalls[0]?.schemaName).toBe("skill_metadata");
    expect(state.aiCalls[0]?.prompt).toContain("The learner described what they want to learn:");
    expect(state.aiCalls[0]?.prompt).toContain('"""I want to learn SQL joins for work."""');
  });

  it("audits SKILL_CREATED with the skill_metadata action, model and usage", async () => {
    const { deps, state } = makeDeps({
      usage: { promptTokens: 500, completionTokens: 90 },
    });

    await makeGenerateSkillMetadata(deps)(INPUT);

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      skillId: 10,
      userId: 1,
      type: EventType.SKILL_CREATED,
    });
    const payload = state.events[0]?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      action: "skill_metadata",
      model: "glm-5.3-flash",
      usage: { promptTokens: 500, completionTokens: 90 },
    });
  });

  it("settles FAILED and audits ERROR_OCCURRED when the AI call fails", async () => {
    const { deps, state } = makeDeps({
      error: { kind: "AiGenerationFailed", detail: "transport down" },
    });

    const result = await makeGenerateSkillMetadata(deps)(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "AiGenerationFailed", detail: "transport down" },
    });
    expect(state.skillUpdates).toEqual([
      { id: 10, patch: { status: SkillStatus.FAILED } },
    ]);
    expect(state.events[0]).toMatchObject({ type: EventType.ERROR_OCCURRED });
    expect(state.attempts[0]).toMatchObject({ outcome: "transport_error" });
  });

  it("fails AiResponseInvalid when the model answers prose instead of JSON", async () => {
    const { deps, state } = makeDeps({ failParse: true });

    const result = await makeGenerateSkillMetadata(deps)(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AiResponseInvalid");
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.FAILED });
    expect(state.attempts[0]).toMatchObject({ outcome: "parse_failed" });
  });

  it("fails AiResponseInvalid when the title or description is empty", async () => {
    const { deps, state } = makeDeps({
      raw: JSON.stringify({ title: "", description: "Something." }),
    });

    const result = await makeGenerateSkillMetadata(deps)(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("AiResponseInvalid");
      expect(result.error.detail).toContain("empty");
    }
    expect(state.skillUpdates.at(-1)?.patch).toEqual({ status: SkillStatus.FAILED });
    expect(state.attempts[0]).toMatchObject({ outcome: "empty" });
  });

  it("clamps an over-long generated title to the topic column width", async () => {
    const { deps, state } = makeDeps({
      raw: JSON.stringify({ title: "x".repeat(400), description: "d" }),
    });

    const result = await makeGenerateSkillMetadata(deps)(INPUT);

    expect(result.ok).toBe(true);
    expect((state.skillUpdates[0]?.patch.topic as string)).toHaveLength(255);
  });
});
