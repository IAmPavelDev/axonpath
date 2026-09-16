import { describe, expect, it } from "vitest";
import { canTransition, SKILL_TRANSITIONS } from "./skill";

describe("canTransition", () => {
  it("allows transitions declared in the map", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "COMPLETED")).toBe(true);
    expect(canTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransition("COMPLETED", "ARCHIVED")).toBe(true);
  });

  it("rejects transitions not in the map", () => {
    expect(canTransition("DRAFT", "COMPLETED")).toBe(false);
    expect(canTransition("DRAFT", "PAUSED")).toBe(false);
    expect(canTransition("COMPLETED", "ACTIVE")).toBe(false);
    expect(canTransition("ACTIVE", "ACTIVE")).toBe(false);
  });

  it("ARCHIVED is terminal", () => {
    expect(SKILL_TRANSITIONS.ARCHIVED).toEqual([]);
    expect(canTransition("ARCHIVED", "ACTIVE")).toBe(false);
  });
});
