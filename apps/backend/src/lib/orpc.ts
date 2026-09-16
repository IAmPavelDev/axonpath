import { implement } from "@orpc/server";
import { contract } from "@axon/api-contract";
import { authMiddleware } from "@/modules/identity/api/auth.middleware";

export const rpc = implement(contract).use(authMiddleware);
