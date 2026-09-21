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

const edit = oc
  .route({
    method: "POST",
    path: `${BASE_PATH}/:id/edit`,
    summary: "Edit skill",
    tags: ["Skill", "Edit"],
  })
  .input(schema.EditSkillInput)
  .output(schema.StatusOnly);

const get = oc
  .route({
    method: "GET",
    path: `${BASE_PATH}/:id`,
    summary: "Get a skill by id",
    tags: ["Skill", "Get"],
  })
  .input(schema.SkillIdInput)
  .output(schema.GetSkillByIdOutput);

const retry = oc
  .route({
    method: "POST",
    path: `${BASE_PATH}/:id/retry`,
    summary: "Retry AI generation for a failed skill",
    tags: ["Skill", "Retry"],
  })
  .input(schema.SkillIdInput)
  .output(schema.StatusOnly);

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
  edit,
  get,
  list,
  retry
}

export type SkillContractType = typeof skillContract;
