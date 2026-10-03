import z from "zod";

export const GetClassListInput = z.object({
  skillId: z.number(),
});

export const GetClassListOutput = z.array(
  z.object({
    id: z.number(),
    title: z.string(),
    createdAt: z.date(),
    questionCount: z.number().int(),
    learnedPoints: z.number().int(),
    lastActivityAt: z.date().nullable(),
  }),
);

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
  /** Verbatim learner selection the question is about; null when anchored by tap. */
  anchorText: z.string().trim().min(1).max(2000).optional(),
  question: z.string().trim().min(1).max(4000),
});

export const AskClassQuestionOutput = z.object({
  blockId: z.number(),
  status: ClassQaStatus,
});

export const RetryClassQaInput = z.object({
  classId: z.number(),
  /** The FAILED block to restart in place — same id, same anchor. */
  blockId: z.number(),
});

export const ClassQaBlock = z.object({
  id: z.number(),
  classId: z.number(),
  anchorParagraph: z.number().int(),
  /** Stored learner selection; null for tap-anchored or pre-Phase-8 blocks. */
  anchorText: z.string().nullable(),
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
