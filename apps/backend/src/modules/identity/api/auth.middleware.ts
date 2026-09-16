import type { ContextType } from "@/modules/platform/context";
import { prisma } from "@/modules/platform/infrastructure/prisma";
import type { Middleware, ORPCErrorConstructorMap } from "@orpc/server";

/**
 * [STUB / dev-only] Authentication is hard-coded to user id 1. Mobile sends a
 * Bearer header the server ignores. Replaced by real auth when identity work
 * lands; the middleware boundary stays.
 */
export const authMiddleware: Middleware<
  Record<string, never>,
  ContextType,
  unknown,
  unknown,
  ORPCErrorConstructorMap<Record<never, never>>,
  Record<never, never>
> = async ({ next }) => {
  let user;
  try {
    user = await prisma.user.upsert({
      where: { id: 1 },
      update: {
        lastLogin: new Date(),
      },
      create: {
        id: 1,
        firstName: "John",
        lastName: "Doe",
        password: "password",
        email: "john.doe@example.com",
        role: "ADMIN",
        lastLogin: new Date(),
      },
    });
  } catch (err) {
    console.log("Error upserting user", err);
  }

  return next({
    context: {
      user
    } as ContextType,
  });
};
