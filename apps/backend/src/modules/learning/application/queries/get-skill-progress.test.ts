import { describe, expect, it } from "vitest";
import {
  makeGetSkillProgress,
  type GetSkillProgressDeps,
} from "./get-skill-progress";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";

const unused = async (): Promise<never> => {
  throw new Error("not used in progress tests");
};

/** Test seam: ownership stub + scripted lessons and per-class answer stats. */
const makeFakeDeps = (options: {
  skill?: { id: number; userId: number; topic: string; description: string; status: string } | null;
  classes?: Array<{ id: number; index: number; title: string; questionCount: number }>;
  stats?: Array<{ classId: number; answeredCount: number; correctCount: number }>;
}) => {
  const skill =
    options.skill === undefined
      ? { id: 42, userId: 7, topic: "SQL joins", description: "", status: "ACTIVE" }
      : options.skill;

  const skillRepo: SkillRepository = {
    create: unused,
    update: unused,
    findById: async () => skill,
    listByUser: unused,
    listByStatus: unused,
  };
  const classRepo: ClassRepository = {
    findQuestionCountsByClassIds: unused,
    createWithQuestions: unused,
    listBySkill: unused,
    listBySkillByIndex: async () => options.classes ?? [],
    listByIds: unused,
    findTopBySkill: unused,
    findById: unused,
  };
  const quizRepo: QuizRepository = {
    findWrongAnswersBySkill: unused,
    findAnswerActivityByUser: unused,
    findByClassId: unused,
    findScoreableByClassId: unused,
    createAnswers: unused,
    findAnswersByClassAndUser: unused,
    findHighestAnsweredClassIndex: unused,
    findAnswerStatsBySkill: async () => options.stats ?? [],
    findAnswersWithQuestions: unused,
    updateGrades: unused,
  };

  const deps: GetSkillProgressDeps = { skillRepo, classRepo, quizRepo };
  return deps;
};

describe("makeGetSkillProgress", () => {
  const input = { skillId: 42, userId: 7 };

  it("reports zeros for a skill without lessons or answers", async () => {
    const result = await makeGetSkillProgress(makeFakeDeps({}))(input);

    expect(result).toEqual({
      ok: true,
      value: {
        skillId: 42,
        topic: "SQL joins",
        status: "ACTIVE",
        totals: {
          lessonCount: 0,
          completedLessons: 0,
          learnedPoints: 0,
          accuracy: null,
        },
        classes: [],
      },
    });
  });

  it("reports zeros and no accuracy for lessons nothing was answered in", async () => {
    const result = await makeGetSkillProgress(
      makeFakeDeps({
        classes: [{ id: 101, index: 0, title: "Inner joins", questionCount: 4 }],
      }),
    )(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals).toEqual({
      lessonCount: 1,
      completedLessons: 0,
      learnedPoints: 0,
      accuracy: null,
    });
    expect(result.value.classes[0]).toEqual({
      classId: 101,
      index: 0,
      title: "Inner joins",
      questionCount: 4,
      answeredCount: 0,
      correctCount: 0,
      completed: false,
      accuracy: null,
    });
  });

  it("computes a partially-answered class without marking it completed", async () => {
    const result = await makeGetSkillProgress(
      makeFakeDeps({
        classes: [{ id: 101, index: 0, title: "Inner joins", questionCount: 4 }],
        stats: [{ classId: 101, answeredCount: 2, correctCount: 1 }],
      }),
    )(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classes[0]).toMatchObject({
      answeredCount: 2,
      correctCount: 1,
      completed: false,
      accuracy: 0.5,
    });
    expect(result.value.totals).toEqual({
      lessonCount: 1,
      completedLessons: 0,
      learnedPoints: 2,
      accuracy: 0.5,
    });
  });

  it("marks a fully-answered class completed and aggregates totals in index order", async () => {
    const result = await makeGetSkillProgress(
      makeFakeDeps({
        classes: [
          { id: 101, index: 0, title: "Inner joins", questionCount: 4 },
          { id: 102, index: 1, title: "Outer joins", questionCount: 3 },
        ],
        stats: [
          { classId: 101, answeredCount: 2, correctCount: 1 },
          { classId: 102, answeredCount: 3, correctCount: 2 },
        ],
      }),
    )(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classes.map((c) => c.classId)).toEqual([101, 102]);
    expect(result.value.classes[1]).toMatchObject({
      answeredCount: 3,
      correctCount: 2,
      completed: true,
      accuracy: expect.closeTo(2 / 3, 6),
    });
    expect(result.value.totals).toEqual({
      lessonCount: 2,
      completedLessons: 1,
      learnedPoints: 5,
      accuracy: 0.6,
    });
  });

  it("rejects a skill the user does not own", async () => {
    const result = await makeGetSkillProgress(
      makeFakeDeps({ skill: { id: 42, userId: 8, topic: "SQL joins", description: "", status: "ACTIVE" } }),
    )(input);

    expect(result).toEqual({ ok: false, error: { kind: "NotOwned", skillId: 42 } });
  });

  it("reports SkillNotFound when the skill does not exist", async () => {
    const result = await makeGetSkillProgress(
      makeFakeDeps({ skill: null }),
    )(input);

    expect(result).toEqual({ ok: false, error: { kind: "SkillNotFound", skillId: 42 } });
  });
});
