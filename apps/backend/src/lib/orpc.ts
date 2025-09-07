import { implement } from "@orpc/server";
import { contract } from "@axon/api-contract";
import { authMiddleware } from "@/middleware/auth";

export const rpc = implement(contract)
  .$context<{ something?: string }>()
  .use(authMiddleware);
