import { describe, expect, it } from "vitest";
import { ORPCError } from "@orpc/server";
import type { Context } from "@orpc/server";
import type { IncomingHttpHeaders } from "node:http";
import { makeAuthMiddleware } from "./auth.middleware";
import type { AuthMiddleware } from "./auth.middleware";
import type { FirebaseIdentity } from "@/modules/identity/ports/token-verifier";
import type { User } from "@/prisma/generated";

const identity: FirebaseIdentity = {
  uid: "uid-1",
  email: "jane@example.com",
  emailVerified: true,
  name: "Jane Doe",
  picture: null,
  provider: "password",
};

const user = { id: 7, email: "jane@example.com" } as unknown as User;

const makeDeps = (
  overrides: {
    verify?: (token: string) => Promise<FirebaseIdentity>;
    authenticate?: (identity: FirebaseIdentity) => Promise<User>;
  } = {},
) => ({
  verifier: { verify: overrides.verify ?? (async () => identity) },
  authenticate: overrides.authenticate ?? (async () => user),
});

type MiddlewareOptions = Parameters<AuthMiddleware>[0];

// oRPC middlewares have the signature (options, input, outputFn); the auth
// middleware only uses `context` and `next`, so stub the rest and echo the
// context back from `next` for assertions.
const makeOptions = (headers: IncomingHttpHeaders): MiddlewareOptions => ({
  context: { headers },
  path: [],
  procedure: {} as MiddlewareOptions["procedure"],
  lastEventId: undefined,
  errors: {},
  next: async ({ context }: { context?: Context } = {}) => ({ output: undefined, context: context! }),
});

const call = (middleware: AuthMiddleware, headers: IncomingHttpHeaders) =>
  middleware(makeOptions(headers), undefined, (output) => ({ output, context: {} }));

const run = (headers: IncomingHttpHeaders) => call(makeAuthMiddleware(makeDeps()), headers);

/** Awaits a promise that should reject; resolves to the caught error. */
const errorOf = async (outcome: unknown) => {
  try {
    return await outcome;
  } catch (err) {
    return err;
  }
};

const asORPCError = (err: unknown) => (err instanceof ORPCError ? err : undefined);

describe("authMiddleware", () => {
  it("passes the resolved user into the context on success", async () => {
    const result = await run({ authorization: "Bearer token-1" });

    expect(result.context.user.id).toBe(7);
  });

  it("rejects requests without an authorization header", async () => {
    const err = await errorOf(run({}));

    expect(err).toBeInstanceOf(ORPCError);
    expect(asORPCError(err)?.code).toBe("UNAUTHORIZED");
  });

  it("rejects non-bearer authorization schemes", async () => {
    const err = await errorOf(run({ authorization: "Basic abc" }));

    expect(asORPCError(err)?.code).toBe("UNAUTHORIZED");
  });

  it("maps token verification failures to UNAUTHORIZED with the verifier detail", async () => {
    const middleware = makeAuthMiddleware(
      makeDeps({
        verify: async () => {
          throw { kind: "InvalidToken", detail: "token expired" };
        },
      }),
    );

    const err = await errorOf(call(middleware, { authorization: "Bearer bad" }));

    expect(asORPCError(err)?.code).toBe("UNAUTHORIZED");
    expect(asORPCError(err)?.message).toBe("token expired");
  });

  it("maps provisioning failures to INTERNAL instead of leaking", async () => {
    const middleware = makeAuthMiddleware(
      makeDeps({ authenticate: async () => { throw new Error("db down"); } }),
    );

    const err = await errorOf(call(middleware, { authorization: "Bearer token-1" }));

    expect(asORPCError(err)?.code).toBe("INTERNAL");
  });
});
