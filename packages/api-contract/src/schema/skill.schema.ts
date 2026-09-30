import z from 'zod';

export const CreateSkillInput = z.object({
  topic: z.string(),
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
});

export const StatusOnly = z.object({ status: z.string() });

/** User-settable lifecycle targets — GENERATING/FAILED are machine-managed. */
export const UpdateSkillStatusInput = z.object({
  id: z.number().int().positive().min(1),
  status: z.enum(["PAUSED", "ACTIVE", "COMPLETED", "ARCHIVED"]),
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
