import { describe, expect, it } from "vitest";
import { latestWrongPerQuestion } from "./latest-wrong";

const at = (iso: string): Date => new Date(iso);
const attempt = (
  questionId: number,
  isCorrect: boolean | null,
  answeredAt: string,
) => ({ questionId, isCorrect, answeredAt: at(answeredAt) });

// Rows arrive recency-ordered, newest first.
describe("latestWrongPerQuestion", () => {
  it("keeps the newest attempt per question when it is wrong", () => {
    const rows = [
      attempt(101, false, "2026-09-30T09:00:00Z"),
      attempt(101, false, "2026-09-28T09:00:00Z"),
      attempt(202, false, "2026-09-29T09:00:00Z"),
    ];

    const kept = latestWrongPerQuestion(rows);

    expect(kept.map((r) => r.questionId)).toEqual([101, 202]);
    expect(kept[0]?.answeredAt).toEqual(at("2026-09-30T09:00:00Z"));
  });

  it("heals a question whose latest attempt is correct (retake wins)", () => {
    // Newest-first: the correct retake (Sep 30) is the latest attempt, so
    // the stale wrong one (Sep 28) must not resurface.
    const rows = [
      attempt(101, true, "2026-09-30T09:00:00Z"),
      attempt(101, false, "2026-09-28T09:00:00Z"),
    ];

    expect(latestWrongPerQuestion(rows)).toEqual([]);
  });

  it("hides a question whose latest attempt is still pending grading", () => {
    const rows = [
      attempt(101, null, "2026-09-30T09:00:00Z"),
      attempt(101, false, "2026-09-28T09:00:00Z"),
    ];

    expect(latestWrongPerQuestion(rows)).toEqual([]);
  });

  it("returns empty for rows without any wrong attempt and preserves order", () => {
    const rows = [
      attempt(1, true, "2026-09-30T09:00:00Z"),
      attempt(2, null, "2026-09-29T09:00:00Z"),
    ];

    expect(latestWrongPerQuestion(rows)).toEqual([]);
  });
});
