import { oc } from "@orpc/contract";
import * as schema from "../schema/class.schema.js";

const BASE_PATH = "/class";

const list = oc
  .route({
    method: "GET",
    path: `${BASE_PATH}/list`,
    summary: "List all classes",
    tags: ["Class", "List"],
  })
  .input(schema.GetClassListInput)
  .output(schema.GetClassListOutput);

const get = oc
  .route({
    method: "GET",
    path: `${BASE_PATH}/:id`,
    summary: "Get class by id",
    tags: ["Class", "Get"],
  })
  .input(schema.GetClassByIdInput)
  .output(schema.GetClassByIdOutput);

const qa = {
  ask: oc
    .route({
      method: "POST",
      path: `${BASE_PATH}/qa/ask`,
      summary: "Ask a question anchored in the class conspect",
      tags: ["Class", "Qa", "Ask"],
    })
    .input(schema.AskClassQuestionInput)
    .output(schema.AskClassQuestionOutput),

  list: oc
    .route({
      method: "GET",
      path: `${BASE_PATH}/qa/list`,
      summary: "List Q&A blocks for a class, ordered by anchor",
      tags: ["Class", "Qa", "List"],
    })
    .input(schema.ListClassQaInput)
    .output(schema.ListClassQaOutput),
};

export const classContract = {
  list,
  get,
  qa,
}

export type ClassContractType = typeof classContract;