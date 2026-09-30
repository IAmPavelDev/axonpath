import { describe, expect, it } from "vitest";
import { makeListClassQa, type ListClassQaDeps } from "./list-class-qa";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassQaEntity } from "@/modules/learning/domain/class-qa/class-qa";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";
import { ClassQaStatus } from "@/prisma/generated";

const CLASS = { id: 5, skillId: 10, title: "Joins", contentMd: "## Intro" };
const SKILL = { id: 10, userId: 7, topic: "SQL", description: "", status: "ACTIVE" };

const block = (
  overrides: Partial<ClassQaEntity> & Pick<ClassQaEntity, "id" | "anchorParagraph">,
): ClassQaEntity => ({
  classId: 5,
  userId: 7,
  question: `question ${overrides.id}`,
  answer: null,
  status: ClassQaStatus.PENDING,
  aiModel: null,
  createdAt: new Date("2026-09-29T00:00:00Z"),
  ...overrides,
});

/** Same order the Prisma adapter produces: (anchorParagraph, createdAt, id) asc. */
const ORDERED: ClassQaEntity[] = [
  block({ id: 3, anchorParagraph: 0 }),
  block({ id: 1, anchorParagraph: 2, createdAt: new Date("2026-09-29T00:00:01Z") }),
  block({ id: 2, anchorParagraph: 2, createdAt: new Date("2026-09-29T00:00:02Z") }),
  block({ id: 4, anchorParagraph: 7 }),
];

const makeDeps = (overrides: { klass?: typeof CLASS | null; skill?: typeof SKILL | null } = {}) => {
  let listedWith: number | null = null;

  const classRepo: ClassRepository = {
    create: async () => {
      throw new Error("not used in list tests");
    },
    listBySkill: async () => {
      throw new Error("not used in list tests");
    },
    listBySkillByIndex: async () => {
      throw new Error("not used in list tests");
    },
    findTopBySkill: async () => {
      throw new Error("not used in list tests");
    },
    findById: async () => overrides.klass === undefined ? CLASS : overrides.klass,
  };

  const skillRepo: SkillRepository = {
    create: async () => {
      throw new Error("not used in list tests");
    },
    update: async () => {
      throw new Error("not used in list tests");
    },
    findById: async () => overrides.skill === undefined ? SKILL : overrides.skill,
    listByUser: async () => {
      throw new Error("not used in list tests");
    },
    listByStatus: async () => {
      throw new Error("not used in list tests");
    },
  };

  const qaRepo: ClassQaRepository = {
    create: async () => {
      throw new Error("not used in list tests");
    },
    listByClass: async (classId) => {
      listedWith = classId;
      return ORDERED;
    },
    findById: async () => {
      throw new Error("not used in list tests");
    },
    answer: async () => {
      throw new Error("not used in list tests");
    },
    markFailed: async () => {
      throw new Error("not used in list tests");
    },
    claimStranded: async () => {
      throw new Error("not used in list tests");
    },
    failExhausted: async () => {
      throw new Error("not used in list tests");
    },
  };

  const deps: ListClassQaDeps = { classRepo, skillRepo, qaRepo };
  return { deps, state: { get listedWith() { return listedWith; } } };
};

describe("listClassQa", () => {
  it("returns the class's blocks in repo (anchor, time) order", async () => {
    const { deps, state } = makeDeps();

    const result = await makeListClassQa(deps)({ classId: 5, userId: 7 });

    expect(state.listedWith).toBe(5);
    expect(result).toEqual({ ok: true, value: ORDERED });
    if (result.ok) {
      expect(result.value.map((b) => [b.anchorParagraph, b.id])).toEqual([
        [0, 3],
        [2, 1],
        [2, 2],
        [7, 4],
      ]);
    }
  });

  it("returns ClassNotFound for an unknown class", async () => {
    const { deps } = makeDeps({ klass: null });

    const result = await makeListClassQa(deps)({ classId: 999, userId: 7 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "ClassNotFound", classId: 999 },
    });
  });

  it("returns NotOwned when the class's skill belongs to another user", async () => {
    const { deps } = makeDeps();

    const result = await makeListClassQa(deps)({ classId: 5, userId: 99 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "NotOwned", skillId: 10 },
    });
  });
});
