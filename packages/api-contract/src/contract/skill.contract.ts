import { oc } from '@orpc/contract';
import * as schema from '@schema/skill.schema.ts';

const BASE_PATH = "/skill";

const create = oc
  .route({
    method: "POST",
    path: `${BASE_PATH}/create`,
    summary: "Create a new skill",
    tags: ["Skill", "Create"],
  })
  .input(schema.CreateSkillInput)
  .output(schema.CreateSkillOutput);

export const skillContract = {
  create,
}