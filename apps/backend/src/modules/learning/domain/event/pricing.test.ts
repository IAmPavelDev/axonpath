import { describe, expect, it } from "vitest";
import { estimateCostUsd, PRICE_PER_MTOKEN_USD } from "./pricing";

describe("estimateCostUsd", () => {
  it("prices input and output at the model's per-million rates", () => {
    // 1M in × $0.6 + 1M out × $2.2 for glm-5.3-flash.
    expect(estimateCostUsd("glm-5.3-flash", 1_000_000, 1_000_000)).toBeCloseTo(
      0.6 + 2.2,
    );
  });

  it("prorates fractional millions", () => {
    expect(estimateCostUsd("glm-5.3-flash", 500_000, 0)).toBeCloseTo(0.3);
    expect(estimateCostUsd("glm-5.3-flash", 0, 250_000)).toBeCloseTo(0.55);
  });

  it("prices embeddings from prompt tokens only", () => {
    expect(estimateCostUsd("gemini-embedding-2", 2_000_000, 0)).toBeCloseTo(0.3);
  });

  it("returns zero for unknown models and zero usage", () => {
    expect(estimateCostUsd("mystery-model", 1_000_000, 1_000_000)).toBe(0);
    expect(estimateCostUsd("glm-5.3-flash", 0, 0)).toBe(0);
  });

  it("has a rate row for every configured model", () => {
    // The report prices exactly the two configured models; a renamed model
    // without a table row would silently cost zero.
    expect(Object.keys(PRICE_PER_MTOKEN_USD)).toEqual(
      expect.arrayContaining(["glm-5.3-flash", "gemini-embedding-2"]),
    );
  });
});
