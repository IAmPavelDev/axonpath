import { skillContract, type SkillContractType } from "./contract/skill.contract.js"
import { classContract, type ClassContractType } from "./contract/class.contract.js"
import * as skillSchema from "./schema/skill.schema.js";
import * as classSchema from "./schema/class.schema.js";
import * as quizSchema from "./schema/quiz.schema.js";
import { quizContract, type QuizContractType } from "./contract/quiz.contract.js";
import { type Question } from "./schema/quiz.schema.js";

export const contract = {
  skill: skillContract,
  class: classContract,
  quiz: quizContract
};

export const schema = {
  skill: skillSchema,
  class: classSchema,
  quiz: quizSchema
}

export type { Question };

export type AppContract = {
  skill: SkillContractType;
  class: ClassContractType;
  quiz: QuizContractType;
}