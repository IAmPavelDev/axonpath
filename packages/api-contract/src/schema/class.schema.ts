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
  skillId: z.number(),
  title: z.string(),
  contentMd: z.string(),
});

export const ClassQaStatus = z.enum(["PENDING", "ANSWERED", "FAILED"]);
export type ClassQaStatus = z.infer<typeof ClassQaStatus>;

export const AskClassQuestionInput = z.object({
  classId: z.number(),
  /** Zero-based index of the top-level markdown block the question anchors after. */
  anchorParagraph: z.number().int().min(0),
  question: z.string().trim().min(1).max(4000),
});

export const AskClassQuestionOutput = z.object({
  blockId: z.number(),
  status: ClassQaStatus,
});

export const ClassQaBlock = z.object({
  id: z.number(),
  classId: z.number(),
  anchorParagraph: z.number().int(),
  question: z.string(),
  /** Null while status is PENDING or FAILED. */
  answer: z.string().nullable(),
  status: ClassQaStatus,
  createdAt: z.date(),
});

export const ListClassQaInput = z.object({
  classId: z.number(),
});

/** Ordered by (anchorParagraph, createdAt) — document order, then ask order. */
export const ListClassQaOutput = z.array(ClassQaBlock);