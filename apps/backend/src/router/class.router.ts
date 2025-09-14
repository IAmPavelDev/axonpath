import { getClassByIdHandler, getClassListHandler } from "@/controllers/class.controller";
import { rpc } from "@/lib/orpc";

const list = rpc.class.list.handler(getClassListHandler);
const get = rpc.class.get.handler(getClassByIdHandler);

export const classRouter = {
  list,
  get,
};