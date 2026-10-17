import { describe, expect, it } from "vitest";
import { validateLessonLanguages } from "./lesson-langs";

describe("validateLessonLanguages", () => {
  it("accepts a coherent base-only lesson", () => {
    expect(
      validateLessonLanguages("## Вітання\nПривіт і до побачення.", "uk", ["uk"]),
    ).toBeNull();
  });

  it("accepts a mixed lesson whose tags match the declared languages", () => {
    const md =
      "Пояснення українською: [[lang:en]]Hello! Good morning![[/lang]] — привітання.";
    expect(validateLessonLanguages(md, "uk", ["uk", "en"])).toBeNull();
  });

  it("rejects a non-BCP-47 base language", () => {
    expect(validateLessonLanguages("text", "ukrainian", ["ukrainian"])).toContain(
      "not a BCP-47 code",
    );
  });

  it("rejects empty contentLanguages", () => {
    expect(validateLessonLanguages("text", "uk", [])).toContain("empty");
  });

  it("rejects contentLanguages without the base language", () => {
    expect(validateLessonLanguages("text", "uk", ["en"])).toContain(
      'must include the base language "uk"',
    );
  });

  it("rejects a declared language with no marker in the markdown", () => {
    expect(validateLessonLanguages("Просто текст.", "uk", ["uk", "en"])).toContain(
      'no [[lang:en]] marker',
    );
  });

  it("rejects an undeclared marker language", () => {
    const md = "[[lang:en]]Hello![[/lang]] привіт";
    expect(validateLessonLanguages(md, "uk", ["uk"])).toContain(
      '[[lang:en]] but contentLanguages does not declare it',
    );
  });

  it("rejects an unclosed marker", () => {
    const md = "текст [[lang:en]]Hello! без закриття";
    expect(validateLessonLanguages(md, "uk", ["uk", "en"])).toContain("unclosed");
  });

  it("rejects a stray closing marker", () => {
    const md = "[[lang:en]]Hello[[/lang]] і [[/lang]] зайвий закриваючий";
    expect(validateLessonLanguages(md, "uk", ["uk", "en"])).toContain("stray");
  });

  it("rejects nested opening markers", () => {
    const md = "[[lang:en]]a [[lang:vi]]b[[/lang]][[/lang]]";
    expect(validateLessonLanguages(md, "uk", ["uk", "en", "vi"])).toContain("nested");
  });
});
