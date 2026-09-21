import type { User } from "@/prisma/generated";
import { ORPCError } from "@orpc/server";
import type {
  Middleware,
  ORPCErrorConstructorMap,
} from "@orpc/server";
import type { IncomingHttpHeaders } from "node:http";
import type { FirebaseIdentity, TokenVerifier } from "@/modules/identity/ports/token-verifier";
import type { ContextType } from "@/modules/platform/context";
import { isTaggedError } from "@/modules/platform/errors";

export type AuthenticateFn = (
  identity: FirebaseIdentity,
) => Promise<User>;

export type AuthMiddlewareDeps = {
  verifier: TokenVerifier;
  authenticate: AuthenticateFn;
};

// Input context is optional: the root oRPC context type is `{}` and `.use()`
// widens the middleware input to that union. main.ts always supplies headers.
export type AuthMiddleware = Middleware<
  { headers?: IncomingHttpHeaders },
  ContextType,
  unknown,
  unknown,
  ORPCErrorConstructorMap<Record<never, never>>,
  Record<never, never>
>;

/**
 * Firebase ID-token authentication. The mobile app sends
 * `Authorization: Bearer <firebaseIdToken>`; we verify the token against
 * Google's public keys and resolve (or provision) the local User row.
 * Every RPC behind `rpc = implement(contract).use(...)` requires a valid
 * token — there is no anonymous access.
 */
export const makeAuthMiddleware =
  ({ verifier, authenticate }: AuthMiddlewareDeps): AuthMiddleware =>
  async ({ context, next }) => {
    const header = context.headers?.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new ORPCError("UNAUTHORIZED", { message: "Missing bearer token" });
    }
    const token = header.slice("Bearer ".length).trim();

    let identity: FirebaseIdentity;
    try {
      identity = await verifier.verify(token);
    } catch (err) {
      const detail = isTaggedError(err) ? err.detail : undefined;
      throw new ORPCError("UNAUTHORIZED", {
        message: detail ?? "Invalid or expired token",
      });
    }

    let user: User;
    try {
      user = await authenticate(identity);
    } catch {
      throw new ORPCError("INTERNAL", { message: "Authentication failed" });
    }

    return next({
      context: {
        user,
      } as ContextType,
    });
  };
