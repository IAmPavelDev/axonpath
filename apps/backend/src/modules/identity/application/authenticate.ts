import type { User } from "@/prisma/generated";
import type { Clock } from "@/modules/platform/ports/clock";
import type { UserRepository } from "@/modules/identity/domain/user/user.repository";
import type { FirebaseIdentity } from "@/modules/identity/ports/token-verifier";

export type AuthenticateDeps = {
  users: UserRepository;
  clock: Clock;
};

/**
 * Resolve the local User row for a verified Firebase identity:
 * 1. match on `firebaseUid`;
 * 2. else link an existing account with the same email (keeps their data);
 * 3. else provision a new account from the token claims.
 * Then refresh profile denormalizations + lastLogin on every request.
 */
export const makeAuthenticate =
  ({ users, clock }: AuthenticateDeps) =>
  async (identity: FirebaseIdentity): Promise<User> => {
    const now = clock.now();

    let user = await users.findByFirebaseUid(identity.uid);

    if (!user) {
      const byEmail = await users.findByEmail(identity.email);
      if (byEmail) {
        user = await users.linkFirebaseUid(byEmail.id, identity.uid, now);
      }
    }

    if (!user) {
      const [firstName, lastName] = displayName(identity);
      user = await users.create({
        email: identity.email,
        firstName,
        lastName,
        firebaseUid: identity.uid,
        photoUrl: identity.picture,
        emailVerified: identity.emailVerified,
        // Google accounts are verified by the provider; password accounts
        // that skipped verification stay PENDING_VERIFICATION.
        status: identity.emailVerified ? "ACTIVE" : "PENDING_VERIFICATION",
        lastLogin: now,
      });
    }

    return users.touchLogin(
      user.id,
      { photoUrl: identity.picture, emailVerified: identity.emailVerified },
      now,
    );
  };

/** "John von Neumann" → ["John", "von Neumann"]; email fallback → "Paul", "Smith". */
const displayName = (identity: FirebaseIdentity): [string, string] => {
  if (identity.name) {
    const trimmed = identity.name.trim();
    const split = trimmed.indexOf(" ");
    if (split === -1) return [trimmed, ""];
    return [trimmed.slice(0, split), trimmed.slice(split + 1)];
  }

  const local = identity.email.split("@")[0] ?? "";
  const parts = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return [parts[0] || "User", parts.slice(1).join(" ")];
};
