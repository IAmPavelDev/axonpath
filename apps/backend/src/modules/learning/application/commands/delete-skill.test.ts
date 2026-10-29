import { describe, expect, it } from "vitest";
import {
  makeDeleteSkill,
  type DeleteSkillDeps,
} from "./delete-skill";
import { err, ok } from "@/modules/platform/result";
import type {
  SkillCoreRow,
  SkillRepository,
} from "@/modules/learning/domain/skill/skill.repository";

const unused = async (): Promise<never> => {
  throw new Error("not used in delete tests");
};

/** Test seam: in-memory skill repo + vector store capturing deletions. */
const makeFakeDeps = (
  skill: SkillCoreRow | null,
  options?: { vectorCleanupFails?: boolean },
) => {
  const deletedIds: number[] = [];

  const skillRepo: SkillRepository = {
    create: unused,
    update: unused,
    findById: async (id) =>
      skill && skill.id === id ? skill : null,
    listByUser: unused,
    listByStatus: unused,
    claimStaleInit: unused,
    claimStaleFirstLesson: unused,
    claimFirstLessonRun: unused,
    settleStaleGenerating: unused,
    delete: async (id) => {
      deletedIds.push(id);
    },
  };

  const deps: DeleteSkillDeps = {
    skillRepo,
    vectorStore: {
      deleteBySkill: async (_skillId) =>
        options?.vectorCleanupFails
          ? err({ kind: "VectorStoreUnavailable", detail: "qdrant down" })
          : ok(null),
    },
  };
  return { deps, deletedIds };
};

describe("makeDeleteSkill", () => {
  const input = { skillId: 42, userId: 7 };
  const skill = (): SkillCoreRow => ({
    id: 42,
    userId: 7,
    topic: "SQL joins",
    prompt: "learn joins",
    description: "Join primer.",
    status: "ACTIVE",
  });

  it("deletes an owned skill regardless of status and cleans its vectors", async () => {
    for (const status of ["ACTIVE", "GENERATING", "FAILED", "ARCHIVED"]) {
      const { deps, deletedIds } = makeFakeDeps({ ...skill(), status });

      const result = await makeDeleteSkill(deps)(input);

      expect(result).toEqual(ok({ deleted: true }));
      expect(deletedIds).toEqual([42]);
    }
  });

  it("reports SkillNotFound when the skill does not exist", async () => {
    const { deps, deletedIds } = makeFakeDeps(null);

    const result = await makeDeleteSkill(deps)(input);

    expect(result).toEqual(err({ kind: "SkillNotFound", skillId: 42 }));
    expect(deletedIds).toEqual([]);
  });

  it("rejects a skill the user does not own", async () => {
    const { deps, deletedIds } = makeFakeDeps({ ...skill(), userId: 99 });

    const result = await makeDeleteSkill(deps)(input);

    expect(result).toEqual(err({ kind: "NotOwned", skillId: 42 }));
    expect(deletedIds).toEqual([]);
  });

  it("still succeeds when the Qdrant cleanup fails (best-effort)", async () => {
    const { deps, deletedIds } = makeFakeDeps(skill(), {
      vectorCleanupFails: true,
    });

    const result = await makeDeleteSkill(deps)(input);

    expect(result).toEqual(ok({ deleted: true }));
    expect(deletedIds).toEqual([42]);
  });
});
