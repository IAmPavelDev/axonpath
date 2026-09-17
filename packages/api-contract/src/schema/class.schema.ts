import z from "zod";

export const GetClassListInput = z.object({
  skillId: z.number(),
});

export const GetClassListOutput = z.array(z.object({
  id: z.number(),
  title: z.string(),
  createdAt: z.date(),
  questionCount: z.number().int(),
  learnedPoints: z.number().int(),
  lastActivityAt: z.date().nullable(),
}));

export const GetClassByIdInput = z.object({
  id: z.number(),
});

export const GetClassByIdOutput = z.object({
  id: z.number(),
  title: z.string(),
  contentMd: z.string(),
});