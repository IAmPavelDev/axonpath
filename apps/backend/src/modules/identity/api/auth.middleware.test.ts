import { describe, expect, it } from "vitest";
import { ORPCError } from "@orpc/server";
import { makeAuthMiddleware } from "./auth.middleware";
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

const run = async (headers: Record<string, string | string[] | undefined>) => {
  const middleware = makeAuthMiddleware(makeDeps());
  return middleware({
    context: { headers },
    next: async ({ context }) => context,
  });
};

describe("authMiddleware", () => {
  it("passes the resolved user into the context on success", async () => {
    const context = (await run({ authorization: "Bearer token-1" })) as {
      user: User;
    };

    expect(context.user.id).toBe(7);
  });

  it("rejects requests without an authorization header", async () => {
    const err = await run({}).catch((e) => e);

    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError).code).toBe("UNAUTHORIZED");
  });

  it("rejects non-bearer authorization schemes", async () => {
    const err = await run({ authorization: "Basic abc" }).catch((e) => e);

    expect((err as ORPCError).code).toBe("UNAUTHORIZED");
  });

  it("maps token verification failures to UNAUTHORIZED with the verifier detail", async () => {
    const middleware = makeAuthMiddleware(
      makeDeps({
        verify: async () => {
          throw { kind: "InvalidToken", detail: "token expired" };
        },
      }),
    );

    const err = await middleware({
      context: { headers: { authorization: "Bearer bad" } },
      next: async () => null,
    }).catch((e) => e);

    expect((err as ORPCError).code).toBe("UNAUTHORIZED");
    expect((err as ORPCError).message).toBe("token expired");
  });

  it("maps provisioning failures to INTERNAL instead of leaking", async () => {
    const middleware = makeAuthMiddleware(
      makeDeps({ authenticate: async () => { throw new Error("db down"); } }),
    );

    const err = await middleware({
      context: { headers: { authorization: "Bearer token-1" } },
      next: async () => null,
    }).catch((e) => e);

    expect((err as ORPCError).code).toBe("INTERNAL");
  });
});
