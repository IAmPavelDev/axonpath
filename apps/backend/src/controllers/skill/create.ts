import { z } from 'zod';
import { CreateSkillInput, SkillIdInput, StatusOnly } from './schema.ts';
import SkillService from '@/services/skill/skill.service.ts';
import { OrpcHandler } from '@/types/OrpcHandler';

export const createSkillHandler: OrpcHandler<
  z.infer<typeof CreateSkillInput>,
  z.infer<typeof StatusOnly> & z.infer<typeof SkillIdInput>
> = async ({ input, context }) => {
  console.log('createSkillHandler');
  const { id: userId } = context.user;

  const skill = await SkillService.createSkill({
    topic: input.topic,
    userId,
  })

  return skill;
};
