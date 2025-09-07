import { z } from 'zod';
import { OrpcHandler } from '@types';
import { SubmitAnswersInput, StatusOnly } from './schema.js';

export const submitAnswersHandler: OrpcHandler<
  z.infer<typeof SubmitAnswersInput>,
  z.infer<typeof StatusOnly>
> = async ({ input, context }) => {
  return { status: 'processing' };
}
