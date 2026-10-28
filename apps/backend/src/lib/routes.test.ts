import { describe, expect, it } from "vitest";
import fastify, { type FastifyInstance } from "fastify";
import { ROUTES } from "@axon/api-contract";
import { registerApiRoutes, type ApiHandlers } from "@/lib/routes";
import type { AuthHookDeps } from "@/lib/auth-hook";
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

const makeAuthDeps = (
  overrides: {
    verify?: (token: string) => Promise<FirebaseIdentity>;
    authenticate?: (identity: FirebaseIdentity) => Promise<User>;
  } = {},
): AuthHookDeps => ({
  verifier: { verify: overrides.verify ?? (async () => identity) },
  authenticate: overrides.authenticate ?? (async () => user),
});

/** Stub handler for every route in the table (registration is exhaustive). */
const makeStubHandlers = (
  impl?: (routeId: string, input: unknown, ctx: unknown) => unknown,
): ApiHandlers =>
  Object.fromEntries(
    ROUTES.map((route) => [
      route.id,
      (input: unknown, ctx: unknown) => impl?.(route.id, input, ctx) ?? { status: "ok" },
    ]),
  );

const buildApp = (
  handlers: ApiHandlers,
  auth: AuthHookDeps,
): FastifyInstance => {
  const app = fastify({ logger: false });
  registerApiRoutes(app, handlers, auth);
  return app;
};

describe("api routes (route-table registration)", () => {
  it("rejects a missing bearer token with the D6 error body", async () => {
    const app = buildApp(makeStubHandlers(), makeAuthDeps());
    const res = await app.inject({ method: "GET", url: "/skill/list" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Missing bearer token",
    });
  });

  it("rejects an invalid token with the verifier's detail", async () => {
    const app = buildApp(
      makeStubHandlers(),
      makeAuthDeps({
        verify: async () => {
          throw { kind: "TokenExpired", detail: "token expired" };
        },
      }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/skill/list",
      headers: { authorization: "Bearer bad-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "token expired",
    });
  });

  it("answers a happy GET with the bare output (no envelope) and coerced query", async () => {
    const seen: { input: unknown; userId: unknown } = { input: null, userId: null };
    const skills = [
      {
        id: 1,
        topic: "t",
        status: "ACTIVE",
        createdAt: new Date(),
        lessonCount: 0,
        completedLessons: 0,
        learnedPoints: 0,
        lastActivityAt: null,
      },
    ];
    const app = buildApp(
      makeStubHandlers((_id, input, ctx) => {
        seen.input = input;
        seen.userId = (ctx as { user: { id: number } }).user.id;
        return skills;
      }),
      makeAuthDeps(),
    );
    const res = await app.inject({
      method: "GET",
      url: "/skill/list?includeArchived=true",
      headers: { authorization: "Bearer good-token" },
    });
    expect(res.statusCode).toBe(200);
    // Dates ride the wire as ISO strings (Fastify JSON serialization), same
    // as the previous build; the parsed object never carries a Date instance.
    expect(res.json()).toEqual(JSON.parse(JSON.stringify(skills)));
    expect(seen.input).toEqual({ includeArchived: true });
    expect(seen.userId).toBe(7);
  });

  it("coerces string path params to numbers for the handler", async () => {
    const seen: { input: unknown } = { input: null };
    const app = buildApp(
      makeStubHandlers((_id, input) => {
        seen.input = input;
        return { status: "ok" };
      }),
      makeAuthDeps(),
    );
    const res = await app.inject({
      method: "POST",
      url: "/skill/5/edit",
      body: { topic: "new topic" },
      headers: { authorization: "Bearer good-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    // Path param + body merge back into the original input shape.
    expect(seen.input).toEqual({ id: 5, topic: "new topic" });
  });

  it("answers 422 VALIDATION when path params fail the schema", async () => {
    const app = buildApp(makeStubHandlers(), makeAuthDeps());
    const res = await app.inject({
      method: "GET",
      url: "/skill/not-a-number",
      headers: { authorization: "Bearer good-token" },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("VALIDATION");
    expect(typeof body.message).toBe("string");
  });

  it("maps tagged NotFound domain errors to 404 with the D6 body", async () => {
    const app = buildApp(
      makeStubHandlers(() => {
        throw { kind: "SkillNotFound", detail: "skill does not exist" };
      }),
      makeAuthDeps(),
    );
    const res = await app.inject({
      method: "GET",
      url: "/skill/999",
      headers: { authorization: "Bearer good-token" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      code: "NOT_FOUND",
      message: "skill does not exist",
    });
  });

  it("hides NotOwned errors behind 404 and maps conflicts to 409", async () => {
    const app = buildApp(
      makeStubHandlers((routeId) => {
        if (routeId === "getSkillById") {
          throw { kind: "NotOwned" };
        }
        throw { kind: "InvalidSkillTransition" };
      }),
      makeAuthDeps(),
    );
    const hidden = await app.inject({
      method: "GET",
      url: "/skill/1",
      headers: { authorization: "Bearer good-token" },
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().code).toBe("NOT_FOUND");

    const conflict = await app.inject({
      method: "POST",
      url: "/skill/1/retry",
      headers: { authorization: "Bearer good-token" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("CONFLICT");
  });

  it("registers every route in the contract table", () => {
    const app = buildApp(makeStubHandlers(), makeAuthDeps());
    for (const route of ROUTES) {
      const url = route.path.replace(/\{(\w+)\}/g, ":$1");
      expect(app.hasRoute({ method: route.method, url }), url).toBe(true);
    }
  });
});
