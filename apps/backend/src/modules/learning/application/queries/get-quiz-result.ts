import type {
  LatestAttemptRow,
  QuizRepository,
} from "@/modules/learning/domain/quiz/quiz.repository";
import type {
  QuestionResult,
  SubmitQuizOutput,
} from "@/modules/learning/application/commands/submit-quiz";

export type GetQuizResultDeps = {
  quizRepo: Pick<QuizRepository, "findLatestAttemptResults">;
};

export type GetQuizResultInput = { classId: number; userId: number };

/** Latest attempt rows in stable question order (questionId asc). */
const orderedRows = (rows: LatestAttemptRow[]): LatestAttemptRow[] =>
  [...rows].sort((a, b) => a.questionId - b.questionId);

const toQuestionResult = (row: LatestAttemptRow): QuestionResult => ({
  questionId: row.questionId,
  type: row.questionType,
  isCorrect: row.isCorrect,
  // The model answer never leaves the server for open-ended questions.
  correctAnswer:
    row.questionType === "OPEN_ENDED"
      ? null
      : typeof row.answerKey === "string"
        ? row.answerKey
        : null,
  userAnswer: row.userAnswer,
});

/**
 * The learner's LATEST attempt for a class as a results view — the same shape
 * submit returns, but rebuilt from persisted answers so the client can show
 * the results page on re-entry and poll in-flight open-ended grading. Null =
 * never submitted. Score counts graded-correct answers, so it climbs as
 * background grading lands; a pending open-ended answer contributes nothing.
 */
export const makeGetQuizResult =
  ({ quizRepo }: GetQuizResultDeps) =>
  async (input: GetQuizResultInput): Promise<SubmitQuizOutput | null> => {
    const rows = await quizRepo.findLatestAttemptResults(
      input.classId,
      input.userId,
    );
    if (rows.length === 0) {
      return null;
    }

    const perQuestion = orderedRows(rows).map(toQuestionResult);
    const score = perQuestion.filter(
      (entry) => entry.isCorrect === true,
    ).length;
    return { score, total: perQuestion.length, perQuestion };
  };
