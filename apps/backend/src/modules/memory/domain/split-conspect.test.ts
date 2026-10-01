import { describe, expect, it } from "vitest";
import { conspectExcerpt, splitConspectChunks } from "./split-conspect";

/**
 * The backend splitter must mirror the client's `splitConspectChunks`
 * (apps/mobile/lib/conspect-chunks.ts) block for block: the anchor index
 * space is client-defined and the backend resolves passages against it.
 */
describe("splitConspectChunks", () => {
  it("splits on blank lines", () => {
    expect(splitConspectChunks("one\n\nthree")).toEqual(["one", "three"]);
  });

  it("keeps a fenced code block as one chunk, blank lines included", () => {
    const md = "before\n\n```sql\nSELECT 1;\n\nSELECT 2;\n```\n\nafter";
    expect(splitConspectChunks(md)).toEqual([
      "before",
      "```sql\nSELECT 1;\n\nSELECT 2;\n```",
      "after",
    ]);
  });

  it("keeps an unterminated fence as one trailing chunk", () => {
    expect(splitConspectChunks("```js\nlet x = 1;")).toEqual(["```js\nlet x = 1;"]);
  });

  it("starts a fresh chunk at a heading without a blank line", () => {
    expect(splitConspectChunks("para\n## Heading\nbody")).toEqual([
      "para",
      "## Heading\nbody",
    ]);
  });

  it("keeps lists and tables in single chunks between blank lines", () => {
    expect(splitConspectChunks("- a\n- b\n\n| h |\n|---|\n| x |")).toEqual([
      "- a\n- b",
      "| h |\n|---|\n| x |",
    ]);
  });

  it("ignores fence markers inside a fence when scanning for the closer", () => {
    const md = "```md\nnested ``` fence stays\n```\ntail";
    expect(splitConspectChunks(md)).toEqual(["```md\nnested ``` fence stays\n```", "tail"]);
  });

  it("drops empty output for blank documents", () => {
    expect(splitConspectChunks("\n\n  \n")).toEqual([]);
  });
});

describe("conspectExcerpt", () => {
  it("strips headings, fences, emphasis, links and collapses whitespace", () => {
    expect(
      conspectExcerpt("## A *bold* [link](https://x.y)\n\nsecond  line", 160),
    ).toBe("A bold link second line");
  });

  it("truncates long text with an ellipsis", () => {
    const out = conspectExcerpt("x".repeat(300), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith("…")).toBe(true);
  });
});
