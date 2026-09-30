import { err, ok, type Result } from "@/modules/platform/result";
import type { QuestionType } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type {
  QuizRepository,
} from "@/modules/learning/domain/quiz/quiz.repository";

export type GetSkillMistakesDeps = {
  skillRepo: Pick<SkillRepository, "findById">;
  quizRepo: Pick<QuizRepository, "findWrongAnswersBySkill">;
};

export type GetSkillMistakesInput = {
  skillId: number;
  userId: number;
};

export type SkillMistake = {
  questionId: number;
  type: QuestionType;
  questionText: string;
  choices: string[];
  yourAnswer: string;
  /** MC/TF only — the OPEN_ENDED model answer never leaves the server (D4). */
  correctAnswer: string | null;
  /** Grader feedback for open-ended answers; null until graded. */
  feedback: string | null;
  score: number | null;
  classId: number | null;
  classIndex: number | null;
  answeredAt: Date;
};

export type GetSkillMistakesError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number };

/** Raw choices Json → string[]; non-string drift is dropped, not thrown. */
const choicesOf = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw.filter((choice): choice is string => typeof choice === "string")
    : [];

const correctAnswerOf = (
  questionType: QuestionType,
  answerKey: unknown,
): string | null => {
  if (questionType === "OPEN_ENDED") {
    return null;
  }
  return typeof answerKey === "string" ? answerKey : null;
};

/**
 * Review list for one skill: the learner's latest wrong answer per question,
 * newest first. The repo contract delivers exactly that — latest attempt per
 * question wins (a correct retake heals the question) and pending
 * (ungraded) answers are not mistakes yet. Ownership first — NotOwned hides
 * behind 404 like every skill read.
 */
export const makeGetSkillMistakes =
  ({ skillRepo, quizRepo }: GetSkillMistakesDeps) =>
  async (
    input: GetSkillMistakesInput,
  ): Promise<Result<SkillMistake[], GetSkillMistakesError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }

    const rows = await quizRepo.findWrongAnswersBySkill(
      input.skillId,
      input.userId,
    );

    return ok(
      rows.map((row): SkillMistake => ({
        questionId: row.questionId,
        type: row.questionType,
        questionText: row.questionText,
        choices: choicesOf(row.choices),
        yourAnswer: row.userAnswer,
        correctAnswer: correctAnswerOf(row.questionType, row.answerKey),
        feedback: row.feedback,
        score: row.score,
        classId: row.classId,
        classIndex: row.classIndex,
        answeredAt: row.answeredAt,
      })),
    );
  };
