import { z } from 'zod';
import { OrpcHandler } from '@types';
import { SkillIdInput, GetSkillByIdOutput } from './schema.js';

export const getSkillByIdHandler: OrpcHandler<
  z.infer<typeof SkillIdInput>,
  z.infer<typeof GetSkillByIdOutput>
> = async ({ input, context }) => {
  return { skillId: 'skill_1', topic: '... ', latestClass: { title: '...', content: '...' } };
}
