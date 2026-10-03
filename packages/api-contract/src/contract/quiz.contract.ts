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

const result = oc
  .route({
    method: "GET",
    path: `${BASE_PATH}/:classId/result`,
    summary: "Get the learner's latest quiz attempt for a class",
    tags: ["Quiz", "Get"],
  })
  .input(schema.GetQuizResultInput)
  .output(schema.GetQuizResultOutput);

export const quizContract = {
  get,
  submit,
  result,
};

export type QuizContractType = typeof quizContract;
