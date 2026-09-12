import { createSkillHandler, getSkillListHandler, editSkillHandler, getSkillByIdHandler } from "@/controllers/skill.controller";
import { rpc } from "@/lib/orpc";

const create = rpc.skill.create.handler(createSkillHandler);
const edit = rpc.skill.edit.handler(editSkillHandler);
const get = rpc.skill.get.handler(getSkillByIdHandler);
const list = rpc.skill.list.handler(getSkillListHandler);

export const skillRouter = {
  create,
  edit,
  get,
  list,
};
