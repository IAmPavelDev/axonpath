import { z } from 'zod';
import { OrpcHandler } from '@types';
import { SkillIdInput, NextClassStatusOutput } from './schema.js';

export const getNextClassStatusHandler: OrpcHandler<
  z.infer<typeof SkillIdInput>,
  z.infer<typeof NextClassStatusOutput>
> = async ({ input, context }) => {
  return { status: 'completed', nextClassId: 'class_2', questionCount: 5 };
}
