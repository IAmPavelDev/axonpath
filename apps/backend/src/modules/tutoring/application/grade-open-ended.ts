import { logger } from "@/lib/logger";

import { ok, type Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import { GRADER_SYSTEM } from "@/modules/tutoring/domain/personas";
import {
  GRADING_SCHEMA,
  buildGradingPrompt,
} from "@/modules/tutoring/domain/prompts";
import { extractJsonObject } from "@/modules/tutoring/domain/parse";
import {
  outcomeForError,
  type RecordAiAttempt,
} from "@/modules/tutoring/infrastructure/ai-attempt.repo";

export const GRADE_OPEN_ENDED_JOB = "grade-open-ended";

export type GradeOpenEndedJobPayload = {
  /** Open-ended answer ids from one submit (uncapped — quizzes carry a handful). */
  answerIds: number[];
};

export const GRADE_FAILED_FEEDBACK = "Grading failed — resubmit to re-grade.";

export type GradeOpenEndedDeps = {
  ai: AiPort;
  quizRepo: QuizRepository;
  recordAiAttempt: RecordAiAttempt;
};

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

/** Verdict-derived feedback when the model returned none for a parsed grade. */
const GRADE_PLACEHOLDER_FEEDBACK = (isCorrect: boolean) =>
  isCorrect ? "Correct." : "Incorrect.";

/**
 * Lenient field reads. The provider treats json_schema as guidance, not a
 * hard contract, so the model drifts: booleans arrive as "true", numbers as
 * "1.0", ids as strings. Strict typeof checks would degrade perfectly good
 * grades to failures — coerce instead.
 */
const asGradeNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asGradeBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
};

type Grade = { score: number; isCorrect: boolean; feedback: string };

/**
 * Per-entry coercion of one AI grading result. Only an unusable answerId
 * skips the entry; drifted-but-decodable fields coerce. A missing score or
 * verdict is derived from the other, so one sloppy field cannot flip a real
 * grade to a failure.
 */
const parseGrading = (raw: string): Map<number, Grade> | null => {
  let parsed: unknown;
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // The model dropped the envelope AND the array brackets, leaving a bare
    // "{...},{...}" sequence: re-wrap and retry before giving up.
    if (stripped.startsWith("{") && stripped.endsWith("}")) {
      try {
        parsed = JSON.parse(`[${stripped}]`);
      } catch {
        parsed = undefined;
      }
    }
    if (parsed === undefined || parsed === null) {
      try {
        parsed = extractJsonObject(raw);
      } catch {
        return null;
      }
    }
  }
  // The provider treats json_schema as guidance and sometimes drops the
  // top-level envelope entirely, emitting the bare results array.
  const results = Array.isArray(parsed)
    ? parsed
    : (parsed as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  const grades = new Map<number, Grade>();
  for (const entry of results) {
    if (typeof entry !== "object" || entry === null) continue;
    const result = entry as Record<string, unknown>;
    const answerId = asGradeNumber(result.answerId);
    if (answerId === null || !Number.isInteger(answerId)) continue;
    const score = asGradeNumber(result.score);
    const correct = asGradeBoolean(result.correct);
    if (score === null && correct === null) continue;
    const isCorrect = correct ?? (score as number) >= 0.5;
    const resolvedScore = Math.min(
      Math.max(score ?? (isCorrect ? 1 : 0), 0),
      1,
    );
    const feedback =
      typeof result.feedback === "string" && result.feedback.trim().length > 0
        ? result.feedback
        : GRADE_PLACEHOLDER_FEEDBACK(isCorrect);
    grades.set(answerId, { score: resolvedScore, isCorrect, feedback });
  }
  return grades;
};
/**
 * Background grading for open-ended answers (Phase 7 D4): ONE batched
 * generateJson call judges the whole submit; grades persist via
 * updateGrades (score/isCorrect set, feedback merged into the content
 * JSON). Degrade, never hang: a malformed or partial response regenerates
 * once — schema drift is a flake, not a verdict — and whatever is still
 * missing after both attempts settles to 0 / incorrect with
 * GRADE_FAILED_FEEDBACK, so nothing stays silently pending forever.
 */
export const makeGradeOpenEnded =
  ({ ai, quizRepo, recordAiAttempt }: GradeOpenEndedDeps) =>
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

    const prompt = buildGradingPrompt({
      attempts: gradeable.map((answer) => ({
        answerId: answer.answerId,
        questionText: answer.questionText,
        modelAnswer: modelAnswerOf(answer.answerKey),
        learnerAnswer: answer.userAnswer,
      })),
    });

    // Every row starts failed; a valid AI result replaces them entry by
    // entry. Absent results after both attempts stay failed.
    let grades: Map<number, Grade> | null = null;
    for (let attempt = 0; attempt < 2 && !grades; attempt++) {
      const attemptStartedAt = Date.now();
      const attemptTag = attempt + 1;
      try {
        const generation = await ai.generateJson(
          { system: GRADER_SYSTEM, prompt },
          { schemaName: "grading", responseSchema: GRADING_SCHEMA },
        );
        if (!generation.ok) {
          logger.warn({ attempt, error: generation.error }, "Open-ended grading generation failed");
          recordAiAttempt({
            operation: "grade_open",
            attempt: attemptTag,
            ...outcomeForError(generation.error),
            latencyMs: Date.now() - attemptStartedAt,
          });
          continue;
        }
        grades = parseGrading(generation.value.raw);
        if (!grades) {
          logger.warn({ attempt, raw: generation.value.raw.slice(0, 500) }, "Open-ended grading response unparsable");
          recordAiAttempt({
            operation: "grade_open",
            attempt: attemptTag,
            outcome: "parse_failed",
            latencyMs: Date.now() - attemptStartedAt,
            promptTokens: generation.value.usage?.promptTokens,
            completionTokens: generation.value.usage?.completionTokens,
            rawChars: generation.value.raw.length,
          });
        } else {
          recordAiAttempt({
            operation: "grade_open",
            attempt: attemptTag,
            outcome: "ok",
            latencyMs: Date.now() - attemptStartedAt,
            promptTokens: generation.value.usage?.promptTokens,
            completionTokens: generation.value.usage?.completionTokens,
            rawChars: generation.value.raw.length,
          });
        }
      } catch (error) {
        // Transport failure: the second attempt gets a fresh generation;
        // whatever is still missing settles failed below.
        logger.warn({ attempt, error }, "Open-ended grading call threw");
        recordAiAttempt({
          operation: "grade_open",
          attempt: attemptTag,
          ...outcomeForError(error),
          latencyMs: Date.now() - attemptStartedAt,
        });
      }
    }

    const rows = gradeable.map((answer) => {
      const grade = grades?.get(answer.answerId);
      return grade
        ? { answerId: answer.answerId, ...grade }
        : failedRow(answer.answerId);
    });
    await quizRepo.updateGrades(rows);
    return ok(undefined);
  };
