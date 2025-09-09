import { implement } from "@orpc/server";
import { contract } from "@axon/api-contract";
import { authMiddleware } from "@/middleware/auth";
import { ContextType } from "@/types/Context";

export const rpc = implement(contract)
  .$context<ContextType>()
  .use(authMiddleware);
