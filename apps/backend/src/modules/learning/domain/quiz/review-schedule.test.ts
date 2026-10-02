import { describe, expect, it } from "vitest";
import {
  REVIEW_MAX_ITEMS,
  REVIEW_MAX_SPIRAL,
  SPIRAL_AFTER_DAYS,
  selectReviewItems,
  type ReviewCandidate,
} from "./review-schedule";

const NOW = new Date("2026-10-02T12:00:00Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const candidate = (
  overrides: Partial<ReviewCandidate> & { attempts: ReviewCandidate["attempts"] },
): ReviewCandidate => ({
  questionId: 1,
  questionText: "What does a LEFT JOIN keep?",
  questionType: "MULTIPLE_CHOICE",
  classIndex: 0,
  ...overrides,
});

describe("selectReviewItems", () => {
  it("returns nothing without candidates or gradable attempts", () => {
    expect(selectReviewItems([], { topClassIndex: 2, now: NOW })).toEqual([]);
    expect(
      selectReviewItems(
        [candidate({ attempts: [{ isCorrect: null, createdAt: daysAgo(1) }] })],
        { topClassIndex: 2, now: NOW },
      ),
    ).toEqual([]);
  });

  it("excludes the newest class's questions (the mistakes block owns them)", () => {
    const items = selectReviewItems(
      [candidate({ classIndex: 3, attempts: [{ isCorrect: false, createdAt: daysAgo(1) }] })],
      { topClassIndex: 3, now: NOW },
    );
    expect(items).toEqual([]);
  });

  it("schedules a standing wrong answer as reteach, most recent first", () => {
    const items = selectReviewItems(
      [
        candidate({
          questionId: 1,
          classIndex: 0,
          attempts: [{ isCorrect: false, createdAt: daysAgo(6) }],
        }),
        candidate({
          questionId: 2,
          classIndex: 1,
          questionText: "Newer miss",
          attempts: [{ isCorrect: false, createdAt: daysAgo(1) }],
        }),
      ],
      { topClassIndex: 3, now: NOW },
    );
    expect(items.map((item) => item.urgency)).toEqual(["reteach", "reteach"]);
    expect(items[0].questionId).toBe(2);
    expect(items[0].note).toContain("1 day ago");
  });

  it("treats a pending latest attempt as not-graded and falls back to the last grade", () => {
    const items = selectReviewItems(
      [
        candidate({
          attempts: [
            { isCorrect: false, createdAt: daysAgo(5) },
            { isCorrect: null, createdAt: daysAgo(0) },
          ],
        }),
      ],
      { topClassIndex: 3, now: NOW },
    );
    expect(items).toHaveLength(1);
    expect(items[0].urgency).toBe("reteach");
  });

  it("schedules a shaky heal as reinforce once a lesson has passed", () => {
    const items = selectReviewItems(
      [
        candidate({
          classIndex: 1,
          attempts: [
            { isCorrect: false, createdAt: daysAgo(9) },
            { isCorrect: true, createdAt: daysAgo(8) },
          ],
        }),
      ],
      { topClassIndex: 3, now: NOW },
    );
    expect(items).toHaveLength(1);
    expect(items[0].urgency).toBe("reinforce");
  });

  it("does not re-drill a just-healed question on the same day", () => {
    const items = selectReviewItems(
      [
        candidate({
          classIndex: 3,
          attempts: [
            { isCorrect: false, createdAt: daysAgo(0) },
            { isCorrect: true, createdAt: daysAgo(0) },
          ],
        }),
      ],
      { topClassIndex: 3, now: NOW },
    );
    expect(items).toEqual([]);
  });

  it("spirals a consistently-correct question after the staleness threshold", () => {
    const recent = selectReviewItems(
      [candidate({ attempts: [{ isCorrect: true, createdAt: daysAgo(1) }] })],
      { topClassIndex: 3, now: NOW },
    );
    expect(recent).toEqual([]);

    const stale = selectReviewItems(
      [
        candidate({
          attempts: [{ isCorrect: true, createdAt: daysAgo(SPIRAL_AFTER_DAYS) }],
        }),
      ],
      { topClassIndex: 3, now: NOW },
    );
    expect(stale).toHaveLength(1);
    expect(stale[0].urgency).toBe("spiral");
  });

  it("caps spiral items harder than the other tiers", () => {
    const staleCorrect = [0, 1, 2].map((i) =>
      candidate({
        questionId: i + 1,
        attempts: [{ isCorrect: true, createdAt: daysAgo(SPIRAL_AFTER_DAYS + i) }],
      }),
    );
    const items = selectReviewItems(staleCorrect, { topClassIndex: 3, now: NOW });
    expect(items).toHaveLength(REVIEW_MAX_SPIRAL);
  });

  it("fills the overall cap by tier priority: reteach > reinforce > spiral", () => {
    const mixed = [
      ...[0, 1, 2].map((i) =>
        candidate({
          questionId: 10 + i,
          classIndex: 0,
          attempts: [{ isCorrect: false, createdAt: daysAgo(5 + i) }],
        }),
      ),
      ...[0, 1, 2].map((i) =>
        candidate({
          questionId: 20 + i,
          classIndex: 1,
          attempts: [
            { isCorrect: false, createdAt: daysAgo(9) },
            { isCorrect: true, createdAt: daysAgo(8 + i) },
          ],
        }),
      ),
      ...[0, 1, 2].map((i) =>
        candidate({
          questionId: 30 + i,
          classIndex: 0,
          attempts: [{ isCorrect: true, createdAt: daysAgo(SPIRAL_AFTER_DAYS + 1 + i) }],
        }),
      ),
    ];
    const items = selectReviewItems(mixed, { topClassIndex: 3, now: NOW });
    expect(items).toHaveLength(REVIEW_MAX_ITEMS);
    expect(items.map((item) => item.urgency)).toEqual([
      "reteach",
      "reteach",
      "reteach",
      "reinforce",
      "reinforce",
    ]);
  });
});
