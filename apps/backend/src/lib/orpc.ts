import { implement } from "@orpc/server";
import { contract } from "@axon/api-contract";
import { makeAuthMiddleware } from "@/modules/identity/api/auth.middleware";
import { makeFirebaseTokenVerifier } from "@/modules/identity/infrastructure/firebase-token-verifier";
import { makePrismaUserRepository } from "@/modules/identity/infrastructure/user.prisma.repo";
import { makeAuthenticate } from "@/modules/identity/application/authenticate";
import { makeSystemClock } from "@/modules/platform/ports/clock";
import { config } from "@/modules/platform/config";

// Middleware wiring lives here because the middleware wraps every procedure
// at contract-implementation time; identity adapters are constructed inline
// for the same reason (container.ts wires only the learning API deps).
export const rpc = implement(contract).use(
  makeAuthMiddleware({
    verifier: makeFirebaseTokenVerifier({
      projectId: config.auth.firebaseProjectId,
    }),
    authenticate: makeAuthenticate({
      users: makePrismaUserRepository(),
      clock: makeSystemClock(),
    }),
  }),
);
