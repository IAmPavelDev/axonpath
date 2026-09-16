import { describe, expect, it } from "vitest";
import { scoreAnswer } from "./scoring";

describe("scoreAnswer", () => {
  it("scores MC exact match as correct", () => {
    const result = scoreAnswer(
      { type: "MULTIPLE_CHOICE", answerKey: "B" },
      { answer: "B" },
    );
    expect(result).toEqual({ isCorrect: true, score: 1 });
  });

  it("scores MC mismatch as incorrect", () => {
    const result = scoreAnswer(
      { type: "MULTIPLE_CHOICE", answerKey: "B" },
      { answer: "C" },
    );
    expect(result).toEqual({ isCorrect: false, score: 0 });
  });

  it("scores TF exact match", () => {
    expect(scoreAnswer({ type: "TRUE_FALSE", answerKey: "true" }, { answer: "true" })).toEqual({
      isCorrect: true,
      score: 1,
    });
    expect(scoreAnswer({ type: "TRUE_FALSE", answerKey: "true" }, { answer: "false" })).toEqual({
      isCorrect: false,
      score: 0,
    });
  });

  it("stringifies non-string answerKey before comparing", () => {
    const result = scoreAnswer(
      { type: "MULTIPLE_CHOICE", answerKey: "B" },
      { answer: "B" },
    );
    expect(result.isCorrect).toBe(true);
  });

  it("never auto-scores open-ended", () => {
    const result = scoreAnswer(
      { type: "OPEN_ENDED", answerKey: "anything" },
      { answer: "anything" },
    );
    expect(result).toEqual({ isCorrect: false, score: 0 });
  });
});
