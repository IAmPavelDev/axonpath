import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@/prisma/generated";
import type { FirebaseIdentity, TokenVerifier } from "@/modules/identity/ports/token-verifier";
import { makeFirebaseTokenVerifier } from "@/modules/identity/infrastructure/firebase-token-verifier";
import { makePrismaUserRepository } from "@/modules/identity/infrastructure/user.prisma.repo";
import { makeAuthenticate } from "@/modules/identity/application/authenticate";
import { makeSystemClock } from "@/modules/platform/ports/clock";
import { config } from "@/modules/platform/config";
import { isTaggedError } from "@/modules/platform/errors";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth hook for every API route (all 24 are protected). */
    user: User;
  }
}

export type AuthenticateFn = (identity: FirebaseIdentity) => Promise<User>;

export type AuthHookDeps = {
  verifier: TokenVerifier;
  authenticate: AuthenticateFn;
};

// Same wiring the previous auth middleware used: identity adapters
// constructed inline because container.ts wires only the learning API deps.
export const makeAuthHookDeps = (): AuthHookDeps => ({
  verifier: makeFirebaseTokenVerifier({
    projectId: config.auth.firebaseProjectId,
  }),
  authenticate: makeAuthenticate({
    users: makePrismaUserRepository(),
    clock: makeSystemClock(),
  }),
});

/**
 * Firebase ID-token authentication as a Fastify preValidation hook. The
 * mobile app sends `Authorization: Bearer <firebaseIdToken>`; the token is
 * verified against Google's public keys and the local User row is resolved
 * (or provisioned) onto `request.user`. All 24 API routes are behind it —
 * there is no anonymous access. Failures answer the D6 error body.
 */
export const makeAuthHook =
  ({ verifier, authenticate }: AuthHookDeps) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      return reply
        .status(401)
        .send({ code: "UNAUTHORIZED", message: "Missing bearer token" });
    }
    const token = header.slice("Bearer ".length).trim();

    let identity: FirebaseIdentity;
    try {
      identity = await verifier.verify(token);
    } catch (err) {
      const detail = isTaggedError(err) ? err.detail : undefined;
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: detail ?? "Invalid or expired token",
      });
    }

    let user: User;
    try {
      user = await authenticate(identity);
    } catch {
      return reply
        .status(500)
        .send({ code: "INTERNAL_SERVER_ERROR", message: "Authentication failed" });
    }

    request.user = user;
  };
