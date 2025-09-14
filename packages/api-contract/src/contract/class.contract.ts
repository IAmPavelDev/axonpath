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

export const classContract = {
  list,
  get,
}

export type ClassContractType = typeof classContract;