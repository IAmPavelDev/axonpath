import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";

const mocks = vi.hoisted(() => ({
  create: vi.fn((_data: unknown) => Promise.resolve({ id: 1 })),
}));

vi.mock("@/modules/platform/infrastructure/prisma", () => ({
  prisma: { aiAttempt: { create: mocks.create } },
}));

import {
  outcomeForError,
  recordAiAttempt,
} from "@/modules/tutoring/infrastructure/ai-attempt.repo";

describe("recordAiAttempt", () => {
  beforeEach(() => {
    mocks.create.mockClear();
    mocks.create.mockImplementation((_data: unknown) =>
      Promise.resolve({ id: 1 }),
    );
    vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  it("persists the attempt with defaults (attempt 1, model, versions)", () => {
    recordAiAttempt({
      userId: 7,
      operation: "init_skill",
      outcome: "ok",
      latencyMs: 1234.6,
      promptTokens: 100,
      completionTokens: 50,
      rawChars: 900,
    });

    expect(mocks.create).toHaveBeenCalledOnce();
    const [arg] = mocks.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(arg.data).toMatchObject({
      userId: 7,
      operation: "init_skill",
      attempt: 1,
      outcome: "ok",
      latencyMs: 1235,
      promptTokens: 100,
      completionTokens: 50,
      rawChars: 900,
      promptVersion: expect.any(String),
      parserVersion: expect.any(String),
      model: expect.any(String),
    });
  });

  it("never propagates a failed write (fire-and-forget) and warns instead", async () => {
    mocks.create.mockImplementation((_data: unknown) =>
      Promise.reject(new Error("db down")),
    );

    expect(() =>
      recordAiAttempt({
        operation: "qa_answer",
        outcome: "ok",
        latencyMs: 5,
      }),
    ).not.toThrow();

    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "qa_answer" }),
        "Failed to record AI attempt",
      );
    });
  });
});

describe("outcomeForError", () => {
  it("maps a z.ai balance-exhaustion error (code 1113) to balance_error", () => {
    const result = outcomeForError(
      new Error("DataInspectionFailed error code 1113: balance exhausted"),
    );
    expect(result.outcome).toBe("balance_error");
    expect(result.errorKind).toContain("1113");
  });

  it("maps any other thrown error to transport_error", () => {
    expect(outcomeForError(new Error("ECONNRESET")).outcome).toBe(
      "transport_error",
    );
    expect(outcomeForError("weird string throw").outcome).toBe(
      "transport_error",
    );
  });
});
