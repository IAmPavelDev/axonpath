import type { z } from "zod";
import { skillContract, type SkillContractType } from "./contract/skill.contract.js"
import { classContract, type ClassContractType } from "./contract/class.contract.js"
import * as skillSchema from "./schema/skill.schema.js";
import * as classSchema from "./schema/class.schema.js";
import * as authSchema from "./schema/auth.schema.js";
import * as quizSchema from "./schema/quiz.schema.js";
import { quizContract, type QuizContractType } from "./contract/quiz.contract.js";
import { authContract, type AuthContractType } from "./contract/auth.contract.js";
import { type Question } from "./schema/quiz.schema.js";

export const contract = {
  skill: skillContract,
  class: classContract,
  quiz: quizContract,
  auth: authContract
};

export const schema = {
  skill: skillSchema,
  class: classSchema,
  quiz: quizSchema,
  auth: authSchema
}

export type { Question };

/** Named result contract for quiz submission — owned here, consumed by clients. */
export type SubmitQuizAnswersOutput = z.infer<typeof quizSchema.SubmitQuizAnswersOutput>;

export type AppContract = {
  skill: SkillContractType;
  class: ClassContractType;
  quiz: QuizContractType;
  auth: AuthContractType;
}
