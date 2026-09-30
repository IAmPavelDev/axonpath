import { err, ok, type Result } from "@/modules/platform/result";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";

export type GetSkillProgressDeps = {
  skillRepo: SkillRepository;
  classRepo: ClassRepository;
  quizRepo: QuizRepository;
};
export type GetSkillProgressInput = {
  skillId: number;
  userId: number;
};

export type SkillProgressClass = {
  classId: number;
  index: number;
  title: string;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  completed: boolean;
  /** correct / answered; null until the learner has answered anything. */
  accuracy: number | null;
};

export type SkillProgressTotals = {
  lessonCount: number;
  completedLessons: number;
  learnedPoints: number;
  accuracy: number | null;
};

export type SkillProgressOutput = {
  skillId: number;
  topic: string;
  status: string;
  totals: SkillProgressTotals;
  classes: SkillProgressClass[];
};

export type GetSkillProgressError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number };

/**
 * Live per-lesson progress for one skill, derived on read — the SkillProgress
 * snapshot table intentionally stays unused (write cost, no reader). The
 * conventions mirror SkillRepository.listByUser so the detail screen agrees
 * with the list: learned = distinct questions answered (retakes don't
 * inflate), and a class counts completed once every generated question has
 * been answered at least once. "Correct" means answered correctly at least
 * once; today every answer is graded synchronously (MC/TF only), so accuracy
 * is exact — open-ended pending grades will tighten these rules when they
 * arrive. NotOwned hides behind 404 like every ownership-checked read.
 */
export const makeGetSkillProgress =
  ({ skillRepo, classRepo, quizRepo }: GetSkillProgressDeps) =>
  async (
    input: GetSkillProgressInput,
  ): Promise<Result<SkillProgressOutput, GetSkillProgressError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }

    const [classes, stats] = await Promise.all([
      classRepo.listBySkillByIndex(input.skillId),
      quizRepo.findAnswerStatsBySkill(input.skillId, input.userId),
    ]);
    const statsByClass = new Map<number, (typeof stats)[number]>(
      stats.map((s) => [s.classId, s]),
    );

    const progress = classes.map((cls): SkillProgressClass => {
      const stat = statsByClass.get(cls.id);
      const answeredCount = stat?.answeredCount ?? 0;
      const correctCount = stat?.correctCount ?? 0;
      return {
        classId: cls.id,
        index: cls.index,
        title: cls.title,
        questionCount: cls.questionCount,
        answeredCount,
        correctCount,
        completed: cls.questionCount > 0 && answeredCount >= cls.questionCount,
        accuracy: answeredCount > 0 ? correctCount / answeredCount : null,
      };
    });

    const answered = progress.reduce((sum, c) => sum + c.answeredCount, 0);
    const correct = progress.reduce((sum, c) => sum + c.correctCount, 0);

    return ok({
      skillId: skill.id,
      topic: skill.topic,
      status: skill.status,
      totals: {
        lessonCount: progress.length,
        completedLessons: progress.filter((c) => c.completed).length,
        learnedPoints: answered,
        accuracy: answered > 0 ? correct / answered : null,
      },
      classes: progress,
    });
  };
