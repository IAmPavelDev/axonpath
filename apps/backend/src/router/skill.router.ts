import { createSkillHandler, getSkillListHandler } from "@/controllers/skill.controller";
import { rpc } from "@/lib/orpc";

const create = rpc.skill.create.handler(createSkillHandler);
const list = rpc.skill.list.handler(getSkillListHandler);

export const skill = {
  create,
  list,
};