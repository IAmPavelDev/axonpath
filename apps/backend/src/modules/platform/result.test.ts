import { describe, expect, it } from "vitest";
import { err, isErr, ok, unwrapOrThrow } from "./result";

describe("Result", () => {
  it("ok carries value and isErr narrows", () => {
    const result = ok(42);
    expect(isErr(result)).toBe(false);
    expect(unwrapOrThrow(result)).toBe(42);
  });

  it("err carries error and isErr narrows", () => {
    const result = err({ kind: "SkillNotFound" });
    if (isErr(result)) {
      expect(result.error).toEqual({ kind: "SkillNotFound" });
    } else {
      expect.unreachable("err should narrow to failure branch");
    }
  });

  it("unwrapOrThrow maps the error", () => {
    const mapped = { http: 404 };
    expect(() =>
      unwrapOrThrow(err("boom"), (e) => ({ mapped: e, http: mapped.http })),
    ).toThrowError();
  });
});
