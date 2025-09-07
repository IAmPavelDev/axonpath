import { z } from 'zod';
import { OrpcHandler } from '@types';
import { GetSkillClassesInput, SkillClass } from './schema.js';

export const getSkillClassesHandler: OrpcHandler<
  z.infer<typeof GetSkillClassesInput>,
  z.infer<typeof SkillClass>[]
> = async ({ input, context }) => {
  return [];
}
