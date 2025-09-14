import { skillContract, type SkillContractType } from "./contract/skill.contract.js"
import { classContract, type ClassContractType } from "./contract/class.contract.js"
import * as skillSchema from "./schema/skill.schema.js";
import * as classSchema from "./schema/class.schema.js";

export const contract = {
  skill: skillContract,
  class: classContract
};

export const schema = {
  skill: skillSchema,
  class: classSchema
}

export type AppContract = {
  skill: SkillContractType;
  class: ClassContractType;
}