import { ContextType } from "@/types/Context";
import { prisma } from "@prisma/index.ts";

type AuthMiddlewareInput = {
  context: ContextType;
  next: any;
}

export const authMiddleware = async ({ context, next }: AuthMiddlewareInput) => {
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
