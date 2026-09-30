import { describe, expect, it } from "vitest";
import { embeddingTokenCounts } from "./embedding-tokens";

describe("embeddingTokenCounts", () => {
  it("splits a batch total evenly with the remainder on the first vectors", () => {
    // 10 tokens over 3 vectors: 4 + 3 + 3 — the sum stays exactly 10.
    expect(embeddingTokenCounts({ tokens: 10 }, 3)).toEqual([4, 3, 3]);
  });

  it("keeps the sum exact when the total divides evenly", () => {
    expect(embeddingTokenCounts({ tokens: 100 }, 2)).toEqual([50, 50]);
  });

  it("yields nulls when the adapter could not read usage (degrade)", () => {
    expect(embeddingTokenCounts(undefined, 3)).toEqual([null, null, null]);
  });

  it("handles the empty batch and single-vector cases", () => {
    expect(embeddingTokenCounts({ tokens: 7 }, 0)).toEqual([]);
    expect(embeddingTokenCounts({ tokens: 7 }, 1)).toEqual([7]);
    expect(embeddingTokenCounts(undefined, 0)).toEqual([]);
  });
});
