import { ok, type Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import { GRADER_SYSTEM } from "@/modules/tutoring/domain/personas";
import {
  GRADING_SCHEMA,
  buildGradingPrompt,
} from "@/modules/tutoring/domain/prompts";
import { extractJsonObject } from "@/modules/tutoring/domain/parse";

export const GRADE_OPEN_ENDED_JOB = "grade-open-ended";

export type GradeOpenEndedJobPayload = {
  /** Open-ended answer ids from one submit (uncapped — quizzes carry a handful). */
  answerIds: number[];
};

export const GRADE_FAILED_FEEDBACK = "Grading failed — resubmit to re-grade.";

export type GradeOpenEndedDeps = { ai: AiPort; quizRepo: QuizRepository };

export type GradeOpenEnded = (
  input: GradeOpenEndedJobPayload,
) => Promise<Result<void, never>>;

const failedRow = (answerId: number) => ({
  answerId,
  score: 0,
  isCorrect: false,
  feedback: GRADE_FAILED_FEEDBACK,
});

/** For OPEN_ENDED the answerKey IS the model answer (D5); stringify defensively. */
const modelAnswerOf = (answerKey: unknown): string =>
  typeof answerKey === "string" ? answerKey : JSON.stringify(answerKey ?? "");

/**
 * Strict per-entry coercion of one AI grading result. Invalid fields degrade
 * that single entry to a failed grade instead of poisoning the batch.
 */
const parseGrading = (
  raw: string,
): Map<number, { score: number; isCorrect: boolean; feedback: string }> | null => {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    return null;
  }
  // Named cast: untrusted model output, every field re-validated below.
  const results = (parsed as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  const grades = new Map<number, { score: number; isCorrect: boolean; feedback: string }>();
  for (const entry of results) {
    if (typeof entry !== "object" || entry === null) continue;
    const result = entry as Record<string, unknown>;
    if (typeof result.answerId !== "number") continue;
    const score =
      typeof result.score === "number" ? Math.min(Math.max(result.score, 0), 1) : 0;
    const feedback =
      typeof result.feedback === "string" && result.feedback.length > 0
        ? result.feedback
        : GRADE_FAILED_FEEDBACK;
    grades.set(result.answerId, { score, isCorrect: result.correct === true, feedback });
  }
  return grades;
};

/**
 * Background grading for open-ended answers (Phase 7 D4): ONE batched
 * generateJson call judges the whole submit; grades persist via
 * updateGrades (score/isCorrect set, feedback merged into the content
 * JSON). Degrade, never hang — an AI error, a parse failure, or a partial
 * response grades the affected answers 0 / incorrect with
 * GRADE_FAILED_FEEDBACK, so nothing stays silently pending forever.
 */
export const makeGradeOpenEnded =
  ({ ai, quizRepo }: GradeOpenEndedDeps) =>
  async (input: GradeOpenEndedJobPayload): Promise<Result<void, never>> => {
    if (input.answerIds.length === 0) {
      return ok(undefined);
    }

    const answers = await quizRepo.findAnswersWithQuestions(input.answerIds);
    // Defensive re-check: only open-ended rows are graded here.
    const gradeable = answers.filter(
      (answer) => answer.questionType === "OPEN_ENDED",
    );
    if (gradeable.length === 0) {
      return ok(undefined);
    }

    // Every row starts failed; a valid AI result replaces them entry by
    // entry. Absent results in the response stay failed.
    let rows = gradeable.map((answer) => failedRow(answer.answerId));
    try {
      const generation = await ai.generateJson(
        {
          system: GRADER_SYSTEM,
          prompt: buildGradingPrompt({
            attempts: gradeable.map((answer) => ({
              answerId: answer.answerId,
              questionText: answer.questionText,
              modelAnswer: modelAnswerOf(answer.answerKey),
              learnerAnswer: answer.userAnswer,
            })),
          }),
        },
        { schemaName: "grading", responseSchema: GRADING_SCHEMA },
      );
      if (generation.ok) {
        const grades = parseGrading(generation.value.raw);
        if (grades) {
          rows = gradeable.map((answer) => {
            const grade = grades.get(answer.answerId);
            return grade
              ? { answerId: answer.answerId, ...grade }
              : failedRow(answer.answerId);
          });
        }
      }
    } catch {
      // AI or parse failure keeps the failed rows — degrade, never hang.
    }

    await quizRepo.updateGrades(rows);
    return ok(undefined);
  };
