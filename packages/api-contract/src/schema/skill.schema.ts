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
