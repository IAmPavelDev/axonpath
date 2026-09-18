import { prisma } from "@/modules/platform/infrastructure/prisma";
import type { UserRepository } from "@/modules/identity/domain/user/user.repository";

export const makePrismaUserRepository = (): UserRepository => ({
  findByFirebaseUid: (uid) =>
    prisma.user.findUnique({ where: { firebaseUid: uid } }),

  findByEmail: (email) => prisma.user.findUnique({ where: { email } }),

  create: (input) => prisma.user.create({ data: input }),

  linkFirebaseUid: (id, firebaseUid, lastLogin) =>
    prisma.user.update({ where: { id }, data: { firebaseUid, lastLogin } }),

  touchLogin: (id, patch, lastLogin) =>
    prisma.user.update({
      where: { id },
      data: {
        photoUrl: patch.photoUrl,
        emailVerified: patch.emailVerified,
        lastLogin,
      },
    }),
});
