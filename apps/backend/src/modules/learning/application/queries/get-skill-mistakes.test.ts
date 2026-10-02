import { describe, expect, it } from "vitest";
import {
  makeGetSkillMistakes,
  type GetSkillMistakesDeps,
} from "./get-skill-mistakes";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { QuizRepository, WrongAnswerRow } from "@/modules/learning/domain/quiz/quiz.repository";
import { NextClassOptionsState, SkillMode } from "@/prisma/generated";
import { ok } from "@/modules/platform/result";

const SKILL = {
  id: 10,
  topic: "SQL joins",
  description: "",
  status: "ACTIVE",
  mode: SkillMode.AUTOMATIC,
  optionsState: NextClassOptionsState.NONE,
  optionsStateAt: null,
  userId: 7,
};

const row = (overrides: Partial<WrongAnswerRow> = {}): WrongAnswerRow => ({
  answerId: 1,
  questionId: 101,
  questionType: "MULTIPLE_CHOICE",
  questionText: "Which join keeps unmatched left rows?",
  choices: ["LEFT JOIN", "INNER JOIN"],
  answerKey: "LEFT JOIN",
  userAnswer: "INNER JOIN",
  feedback: null,
  score: 0,
  classId: 77,
  classIndex: 2,
  answeredAt: new Date("2026-09-29T10:00:00Z"),
  ...overrides,
});

/** Test seam: ownership via skillRepo.findById, rows recency-ordered. */
const makeDeps = (
  options: {
    skill?: typeof SKILL | null;
    rows?: WrongAnswerRow[];
  } = {},
) => {
  const skillRepo: Pick<SkillRepository, "findById"> = {
    findById: async () => (options.skill === undefined ? SKILL : options.skill),
  };
  const quizRepo: Pick<QuizRepository, "findWrongAnswersBySkill"> = {
    findWrongAnswersBySkill: async () => options.rows ?? [],
  };
  const deps: GetSkillMistakesDeps = { skillRepo, quizRepo };
  return deps;
};

describe("makeGetSkillMistakes", () => {
  it("returns only graded-wrong answers with the MC/TF key exposed", async () => {
    const deps = makeDeps({
      rows: [row()],
    });

    const result = await makeGetSkillMistakes(deps)({ skillId: 10, userId: 7 });

    expect(result).toEqual(
      ok([
        {
          questionId: 101,
          type: "MULTIPLE_CHOICE",
          questionText: "Which join keeps unmatched left rows?",
          choices: ["LEFT JOIN", "INNER JOIN"],
          yourAnswer: "INNER JOIN",
          correctAnswer: "LEFT JOIN",
          feedback: null,
          score: 0,
          classId: 77,
          classIndex: 2,
          answeredAt: new Date("2026-09-29T10:00:00Z"),
        },
      ]),
    );
  });

  it("keeps the OPEN_ENDED model answer server-side and carries feedback instead", async () => {
    const deps = makeDeps({
      rows: [
        row({
          questionId: 202,
          questionType: "OPEN_ENDED",
          questionText: "Explain when a left join drops rows.",
          choices: [],
          answerKey: "When the right side has no match — the row disappears.",
          userAnswer: "It drops rows when the right side is empty.",
          feedback: "Right idea; mention NULL behavior explicitly.",
          score: 0.6,
        }),
      ],
    });

    const result = await makeGetSkillMistakes(deps)({ skillId: 10, userId: 7 });

    expect(result).toEqual(
      ok([
        expect.objectContaining({
          questionId: 202,
          type: "OPEN_ENDED",
          yourAnswer: "It drops rows when the right side is empty.",
          correctAnswer: null,
          feedback: "Right idea; mention NULL behavior explicitly.",
          score: 0.6,
        }),
      ]),
    );
  });

  it("passes the repo's rows through in recency order (latest per question)", async () => {
    // Healing and per-question latest-wins live in the repo (latest-wrong.ts
    // + its tests); the query consumes that contract as-is.
    const deps = makeDeps({
      rows: [
        row({ questionId: 101, userAnswer: "CROSS JOIN", answeredAt: new Date("2026-09-30T09:00:00Z") }),
        row({ questionId: 202, questionType: "TRUE_FALSE", userAnswer: "False", answerKey: "True" }),
      ],
    });

    const result = await makeGetSkillMistakes(deps)({ skillId: 10, userId: 7 });

    if (!result.ok) throw new Error("expected ok");
    expect(result.value.map((m) => m.questionId)).toEqual([101, 202]);
    expect(result.value[0]?.yourAnswer).toBe("CROSS JOIN");
    expect(result.value[1]?.correctAnswer).toBe("True");
  });

  it("normalizes non-string choice drift away", async () => {
    const deps = makeDeps({
      rows: [row({ choices: ["LEFT JOIN", 42, null, "INNER JOIN"] })],
    });

    const result = await makeGetSkillMistakes(deps)({ skillId: 10, userId: 7 });

    if (!result.ok) throw new Error("expected ok");
    expect(result.value[0]?.choices).toEqual(["LEFT JOIN", "INNER JOIN"]);
  });

  it("returns an empty list for a skill without mistakes", async () => {
    const deps = makeDeps({ rows: [] });

    const result = await makeGetSkillMistakes(deps)({ skillId: 10, userId: 7 });

    expect(result).toEqual(ok([]));
  });

  it("errors with SkillNotFound for a missing skill", async () => {
    const deps = makeDeps({ skill: null });

    const result = await makeGetSkillMistakes(deps)({ skillId: 99, userId: 7 });

    expect(result).toEqual({ ok: false, error: { kind: "SkillNotFound", skillId: 99 } });
  });

  it("errors with NotOwned for another user's skill", async () => {
    const deps = makeDeps({ skill: { ...SKILL, userId: 99 } });

    const result = await makeGetSkillMistakes(deps)({ skillId: 10, userId: 7 });

    expect(result).toEqual({ ok: false, error: { kind: "NotOwned", skillId: 10 } });
  });
});
