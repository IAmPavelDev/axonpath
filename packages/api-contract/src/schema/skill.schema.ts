import z from 'zod';
import { QuestionType } from './quiz.schema.js';

/** How the next lesson comes into being (see ARCHITECTURE.md §4.2). */
export const SkillMode = z.enum(['AUTOMATIC', 'MANUAL']);

/** Lifecycle of the MANUAL-mode candidate-target set. */
export const NextClassOptionsState = z.enum(['NONE', 'PENDING', 'READY', 'FAILED']);

export const CreateSkillInput = z.object({
  topic: z.string(),
  mode: SkillMode.default('AUTOMATIC'),
});

export const EditSkillInput = z.object({
  id: z.number().int().positive().min(1),
  topic: z.string().optional(),
  description: z.string().optional(),
});

export const SkillIdInput = z.object({ id: z.number().int().positive().min(1) });

export const CreateSkillOutput = z.object({
  id: z.number(),
  status: z.string(),
});

export const GetSkillListOutput = z.array(z.object({
  id: z.number(),
  topic: z.string(),
  status: z.string(),
  mode: SkillMode,
  createdAt: z.date(),
  lessonCount: z.number().int(),
  completedLessons: z.number().int(),
  learnedPoints: z.number().int(),
  lastActivityAt: z.date().nullable(),
}));

export const GetSkillByIdOutput = z.object({
  id: z.number(),
  topic: z.string(),
  description: z.string(),
  status: z.string(),
  mode: SkillMode,
});

export const StatusOnly = z.object({ status: z.string() });

/** User-settable lifecycle targets — GENERATING/FAILED are machine-managed. */
export const UpdateSkillStatusInput = z.object({
  id: z.number().int().positive().min(1),
  status: z.enum(["PAUSED", "ACTIVE", "COMPLETED", "ARCHIVED"]),
});

/** Switch how the next lesson is chosen. Only ACTIVE/PAUSED skills accept it. */
export const SetSkillModeInput = z.object({
  id: z.number().int().positive().min(1),
  mode: SkillMode,
});

/** One ranked candidate direction for the next manual lesson. */
export const SkillClassOption = z.object({
  id: z.number(),
  rank: z.number().int(),
  text: z.string(),
});

export const GetClassOptionsOutput = z.object({
  state: NextClassOptionsState,
  /**
   * Timestamp of the last state change. The client uses it to tell a fresh
   * PENDING from a stranded one (the generator died with the process) and
   * offer a retry instead of an endless spinner.
   */
  optionsStateAt: z.date().nullable(),
  options: z.array(SkillClassOption),
});

/** Commit a direction (possibly edited) as the next lesson's learning target. */
export const CreateClassInput = z.object({
  id: z.number().int().positive().min(1),
  target: z.string().trim().min(1).max(2000),
});

/** Regenerate the candidate set (also the retry path after FAILED). */
export const RefreshClassOptionsInput = z.object({
  id: z.number().int().positive().min(1),
});

/** Archived skills leave skill.list unless explicitly included (default false). */
export const GetSkillListInput = z
  .object({
    includeArchived: z.boolean().default(false),
  })
  .optional();

export const SkillProgressClass = z.object({
  classId: z.number(),
  index: z.number().int(),
  title: z.string(),
  questionCount: z.number().int(),
  answeredCount: z.number().int(),
  correctCount: z.number().int(),
  completed: z.boolean(),
  /** correct / answered; null until the learner has answered anything. */
  accuracy: z.number().nullable(),
});

export const SkillProgressOutput = z.object({
  skillId: z.number(),
  topic: z.string(),
  status: z.string(),
  totals: z.object({
    lessonCount: z.number().int(),
    completedLessons: z.number().int(),
    learnedPoints: z.number().int(),
    accuracy: z.number().nullable(),
  }),
  classes: z.array(SkillProgressClass),
});

export const SkillMistake = z.object({
  questionId: z.number(),
  type: QuestionType,
  questionText: z.string(),
  choices: z.array(z.string()),
  yourAnswer: z.string(),
  /** MC/TF only — the OPEN_ENDED model answer never leaves the server. */
  correctAnswer: z.string().nullable(),
  feedback: z.string().nullable(),
  score: z.number().nullable(),
  classId: z.number().nullable(),
  classIndex: z.number().int().nullable(),
  answeredAt: z.date(),
});

/** Latest wrong answer per question, newest first; healed questions absent. */
export const SkillMistakesOutput = z.array(SkillMistake);
