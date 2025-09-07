import { z } from 'zod';
import { OrpcHandler } from '@types';
import { SkillIdInput, SkillProgressOutput } from './schema.js';

export const getSkillProgressHandler: OrpcHandler<
  z.infer<typeof SkillIdInput>,
  z.infer<typeof SkillProgressOutput>
> = async ({ input, context }) => {
  return { skillId: input.id, progress: '75%', recommendations: 'Continue to next class' };
}
