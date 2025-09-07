import { z } from 'zod';
import { OrpcHandler } from '@types';
import { GetSkillQuestionsInput, Question } from './schema.js';

export const getSkillQuestionsHandler: OrpcHandler<
  z.infer<typeof GetSkillQuestionsInput>,
  z.infer<typeof Question>[]
> = async ({ input, context }) => {
  return [];
}
