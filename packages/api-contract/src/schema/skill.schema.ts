import z from 'zod';

export const CreateSkillInput = z.object({
  topic: z.string(),
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
}));

export const GetSkillByIdOutput = z.object({
  skillId: z.string(),
  topic: z.string(),
  latestClass: z.object({
    title: z.string(),
    content: z.string(),
  }),
});

export const StatusOnly = z.object({ status: z.string() });
