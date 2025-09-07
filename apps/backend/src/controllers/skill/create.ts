import { z } from 'zod';
import { OrpcHandler } from '@types';
import { CreateSkillInput, SkillIdInput, StatusOnly } from './schema.ts';
import { prisma } from '@prisma/index.ts';

export const createSkillHandler: OrpcHandler<
  z.infer<typeof CreateSkillInput>,
  z.infer<typeof StatusOnly> & z.infer<typeof SkillIdInput>
> = async ({ input, context }) => {
  // ADD THIS LINE FOR DEBUGGING
  console.log(
    '--- INPUT RECEIVED BY HANDLER ---',
    JSON.stringify(input, null, 2),
  );

  // Your existing handler logic
  return { id: 'skill_1', status: 'processing' };
};
