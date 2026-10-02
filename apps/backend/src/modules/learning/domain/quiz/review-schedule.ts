import type { QuestionType } from "@/prisma/generated";

/**
 * The mastery ledger's raw material: every recorded attempt of one question,
 * ordered oldest first. Built by the repository from Answer+Question rows;
 * the pure scheduler below turns it into prompt instructions.
 */
export type ReviewAttempt = {
  /** null = open-ended attempt not graded (yet). */
  isCorrect: boolean | null;
  createdAt: Date;
};

export type ReviewCandidate = {
  questionId: number;
  questionText: string;
  questionType: QuestionType;
  /** Index of the class the question belongs to; null = class-less. */
  classIndex: number | null;
  attempts: ReviewAttempt[];
};

/**
 * One instruction for the next-lesson prompt. Tiers, best-first:
 * - `reteach`: the learner's latest graded attempt is wrong — re-teach the
 *   underlying concept and check it again.
 * - `reinforce`: missed before, now correct — shaky; re-test from a new angle.
 * - `spiral`: consistently correct but not tested for a while — one fresh
 *   question keeps it durable (spaced repetition, kept light).
 */
export type ReviewItem = {
  questionId: number;
  questionText: string;
  urgency: "reteach" | "reinforce" | "spiral";
  /** How long ago / how many lessons back the latest attempt sits. */
  note: string;
};

/** A consistently-correct question becomes a spiral candidate after this long. */
export const SPIRAL_AFTER_DAYS = 3;

/** Prompt-budget caps: review must flavor the lesson, never dominate it. */
export const REVIEW_MAX_ITEMS = 5;
export const REVIEW_MAX_SPIRAL = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Latest attempt with a machine grade, or null when none was ever graded. */
const latestGraded = (
  attempts: ReviewAttempt[],
): { isCorrect: boolean; createdAt: Date } | null => {
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const attempt = attempts[i];
    if (attempt.isCorrect !== null) {
      return { isCorrect: attempt.isCorrect, createdAt: attempt.createdAt };
    }
  }
  return null;
};

const daysSince = (from: Date, now: Date): number =>
  Math.floor((now.getTime() - from.getTime()) / DAY_MS);

/**
 * Select what the next lesson should re-test, from the skill's full answer
 * history. Deterministic and pure — the same ledger always yields the same
 * items, so tests pin the policy:
 *
 * 1. Questions of the newest class (classIndex === topClassIndex) are
 *    excluded — their wrong answers already feed the dedicated
 *    "missed these questions" block; double-instruction would be noise.
 * 2. reteach: latest graded attempt wrong, strictly older than the newest
 *    class. These first — a standing wrong answer is the strongest signal.
 * 3. reinforce: was wrong at least once, latest graded attempt correct, and
 *    not from the newest class. Stale-correct only (>= 1 day or 1 lesson
 *    back) so a just-healed question is not immediately re-drilled.
 * 4. spiral: never wrong and untouched for >= SPIRAL_AFTER_DAYS days.
 *    Capped harder than the others — this is insurance, not remediation.
 *
 * Within a tier, most recently attempted first (freshest signal wins).
 * Overall cap REVIEW_MAX_ITEMS, filled by tier priority.
 */
export const selectReviewItems = (
  candidates: ReviewCandidate[],
  input: { topClassIndex: number | null; now: Date },
): ReviewItem[] => {
  // Internal sort key: the latest graded attempt, for most-recent-first
  // ordering inside each tier (freshest signal wins the scarce slots).
  type Scored = ReviewItem & { sortAt: number };
  const scored: Scored[] = [];

  for (const candidate of candidates) {
    const latest = latestGraded(candidate.attempts);
    if (!latest) {
      continue;
    }
    // The newest class's quiz is covered by the dedicated mistakes block.
    if (
      input.topClassIndex !== null &&
      candidate.classIndex !== null &&
      candidate.classIndex >= input.topClassIndex
    ) {
      continue;
    }

    const staleDays = daysSince(latest.createdAt, input.now);
    const base = {
      questionId: candidate.questionId,
      questionText: candidate.questionText,
      sortAt: latest.createdAt.getTime(),
    };

    if (!latest.isCorrect) {
      scored.push({
        ...base,
        urgency: "reteach",
        note:
          staleDays <= 0
            ? "missed on the latest attempt"
            : `missed ${staleDays} day${staleDays === 1 ? "" : "s"} ago and not re-tested since`,
      });
      continue;
    }

    const everWrong = candidate.attempts.some((a) => a.isCorrect === false);
    if (everWrong) {
      // Freshly healed (today, and no lesson since) needs no re-drill yet.
      const lessonsBack =
        candidate.classIndex !== null && input.topClassIndex !== null
          ? input.topClassIndex - candidate.classIndex
          : null;
      if (staleDays >= 1 || (lessonsBack !== null && lessonsBack >= 1)) {
        scored.push({
          ...base,
          urgency: "reinforce",
          note:
            staleDays >= 1
              ? `missed before, then answered correctly — last correct ${staleDays} day${staleDays === 1 ? "" : "s"} ago`
              : "missed before, then answered correctly on a later lesson",
        });
      }
      continue;
    }

    if (staleDays >= SPIRAL_AFTER_DAYS) {
      scored.push({
        ...base,
        urgency: "spiral",
        note: `answered correctly every time, but not tested for ${staleDays} days`,
      });
    }
  }

  const byRecency = (a: Scored, b: Scored): number => b.sortAt - a.sortAt;
  const take = (items: Scored[]): ReviewItem[] =>
    items.sort(byRecency).map(({ sortAt: _sortAt, ...item }) => item);

  return [
    ...take(scored.filter((item) => item.urgency === "reteach")),
    ...take(scored.filter((item) => item.urgency === "reinforce")),
    ...take(scored.filter((item) => item.urgency === "spiral")).slice(
      0,
      REVIEW_MAX_SPIRAL,
    ),
  ].slice(0, REVIEW_MAX_ITEMS);
};
