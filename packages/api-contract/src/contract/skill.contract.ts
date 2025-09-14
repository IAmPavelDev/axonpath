import { oc } from '@orpc/contract';
import * as schema from '../schema/skill.schema.js';

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

const list = oc
  .route({
    method: "GET",
    path: `${BASE_PATH}/list`,
    summary: "List all skills",
    tags: ["Skill", "List"],
  })
  .output(schema.GetSkillListOutput);

export const skillContract = {
  create,
  list
}

export type SkillContractType = typeof skillContract;