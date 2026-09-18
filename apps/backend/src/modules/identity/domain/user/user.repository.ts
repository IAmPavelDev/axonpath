import type { User, UserStatus } from "@/prisma/generated";

export type UserRepository = {
  findByFirebaseUid(uid: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: {
    email: string;
    firstName: string;
    lastName: string;
    firebaseUid: string;
    photoUrl: string | null;
    emailVerified: boolean;
    status: UserStatus;
    lastLogin: Date;
  }): Promise<User>;
  /** Attach a Firebase identity to an existing (email-matched) account. */
  linkFirebaseUid(
    id: number,
    firebaseUid: string,
    lastLogin: Date,
  ): Promise<User>;
  /** Refresh denormalized profile fields + lastLogin on every request. */
  touchLogin(
    id: number,
    patch: { photoUrl: string | null; emailVerified: boolean },
    lastLogin: Date,
  ): Promise<User>;
};
