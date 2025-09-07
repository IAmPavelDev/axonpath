import { createSkillHandler } from "@controllers/skill/create";
import { rpc } from "@/lib/orpc";

const create = rpc.skill.create.handler(createSkillHandler);

export const skill = {
  create,
};