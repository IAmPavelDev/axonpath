import z from 'zod';

export const CreateSkillInput = z.object({
  topic: z.string(),
});

export const SkillIdInput = z.object({ id: z.number().min(1) });

export const CreateSkillOutput = z.object({
  id: z.string(),
  status: z.string(),
});

export const GetSkillByIdOutput = z.object({
  skillId: z.string(),
  topic: z.string(),
  latestClass: z.object({
    title: z.string(),
    content: z.string(),
  }),
});

export const GetSkillClassesInput = z.object({
  id: z.string().min(1),
  limit: z.number().int().positive().optional(),
  beforeIndex: z.string().optional(),
});

export const SkillClass = z.object({
  id: z.string(),
  title: z.string(),
  content_md: z.string(),
});

export const GetSkillQuestionsInput = z.object({
  id: z.string().min(1),
  classIndex: z.string().optional(),
});

export const Question = z.object({
  questionId: z.string(),
  text: z.string(),
  choices: z.array(z.string()),
  answer_key: z.string(),
});

export const AnswerItem = z.object({
  questionId: z.string().min(1),
  content: z.any(),
  timeSpentMs: z.number().int().positive(),
});

export const SubmitAnswersInput = z.object({
  id: z.string().min(1),
  items: z.array(AnswerItem),
});

export const StatusOnly = z.object({ status: z.string() });

export const NextClassStatusOutput = z.object({
  status: z.string(),
  nextClassId: z.string().optional(),
  questionCount: z.number().optional(),
});

export const SkillProgressOutput = z.object({
  skillId: z.string(),
  progress: z.string(),
  recommendations: z.string(),
});
