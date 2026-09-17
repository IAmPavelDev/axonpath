import { oc } from "@orpc/contract";
import * as schema from "../schema/quiz.schema.js";

const BASE_PATH = "/quiz";

const get = oc
  .route({
    method: "GET",
    path: `${BASE_PATH}/:id`,
    summary: "Get quiz by id",
    tags: ["Quiz", "Get"],
  })
  .input(schema.GetQuizByClassIdInput)
  .output(schema.GetQuizByClassIdOutput);

const submit = oc
  .route({
    method: "POST",
    path: `${BASE_PATH}/:classId/submit`,
    summary: "Submit quiz answers",
    tags: ["Quiz", "Submit"],
  })
  .input(schema.SubmitQuizAnswersInput)
  .output(schema.SubmitQuizAnswersOutput);

export const quizContract = {
  get,
  submit,
}

export type QuizContractType = typeof quizContract;