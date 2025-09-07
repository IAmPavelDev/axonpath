import { z } from 'zod';
import { OrpcHandler } from '@types';
import { SkillIdInput, StatusOnly } from './schema.js';

export const generateQuestionsHandler: OrpcHandler<
  z.infer<typeof SkillIdInput>,
  z.infer<typeof StatusOnly>
> = async ({ input, context }) => {
  return { status: 'processing' };
}
