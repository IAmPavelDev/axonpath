import rpc from "@/utils/rpc";
import type { z } from 'zod';
import { schema } from '@axon/api-contract';

export type Skill = Awaited<ReturnType<typeof rpc.skill.list>>[0];
export type SkillDetail = Awaited<ReturnType<typeof rpc.skill.get>>;

/** skill.progress response: live per-lesson progress for one skill. */
export type SkillProgress = z.infer<typeof schema.skill.SkillProgressOutput>;

/** The four user-settable lifecycle targets (skill.updateStatus). */
export type SettableSkillStatus = z.infer<
  typeof schema.skill.UpdateSkillStatusInput
>['status'];

/** skill.mistakes item: the latest wrong answer per question, newest first. */
export type SkillMistake = z.infer<typeof schema.skill.SkillMistake>;
