import { createSkillHandler, getSkillListHandler, editDescriptionHandler, editTopicHandler, getSkillByIdHandler } from "@/controllers/skill.controller";
import { rpc } from "@/lib/orpc";

const create = rpc.skill.create.handler(createSkillHandler);
const editDescription = rpc.skill.editDescription.handler(editDescriptionHandler);
const editTopic = rpc.skill.editTopic.handler(editTopicHandler);
const get = rpc.skill.get.handler(getSkillByIdHandler);
const list = rpc.skill.list.handler(getSkillListHandler);

export const skillRouter = {
  create,
  editDescription,
  editTopic,
  get,
  list,
};