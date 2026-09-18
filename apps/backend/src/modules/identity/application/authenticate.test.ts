import { describe, expect, it } from "vitest";
import { makeAuthenticate } from "./authenticate";
import type { UserRepository } from "@/modules/identity/domain/user/user.repository";
import type { FirebaseIdentity } from "@/modules/identity/ports/token-verifier";
import type { User } from "@/prisma/generated";

/** In-memory repo mirroring the Prisma semantics the use case relies on. */
const makeMemoryUserRepository = (seed: User[] = []) => {
  const rows = new Map(seed.map((user) => [user.id, user]));
  let nextId = seed.length + 1;

  const repo: UserRepository = {
    findByFirebaseUid: async (uid) =>
      [...rows.values()].find((user) => user.firebaseUid === uid) ?? null,
    findByEmail: async (email) =>
      [...rows.values()].find((user) => user.email === email) ?? null,
    create: async (input) => {
      const user = {
        id: nextId++,
        role: "USER",
        verificationToken: null,
        resetToken: null,
        resetTokenExpires: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        password: null,
        ...input,
      } as User;
      rows.set(user.id, user);
      return user;
    },
    linkFirebaseUid: async (id, firebaseUid, lastLogin) => {
      const user = { ...rows.get(id)!, firebaseUid, lastLogin };
      rows.set(id, user);
      return user;
    },
    touchLogin: async (id, patch, lastLogin) => {
      const user = {
        ...rows.get(id)!,
        photoUrl: patch.photoUrl,
        emailVerified: patch.emailVerified,
        lastLogin,
      };
      rows.set(id, user);
      return user;
    },
  };
  return { repo, rows };
};

const identity = (overrides: Partial<FirebaseIdentity> = {}): FirebaseIdentity => ({
  uid: "uid-1",
  email: "new.user@example.com",
  emailVerified: true,
  name: "Grace Brewster Hopper",
  picture: "https://example.com/grace.png",
  provider: "google.com",
  ...overrides,
});

const fixedClock = { now: () => new Date("2026-09-18T00:00:00Z") };

describe("authenticate", () => {
  it("provisions a new account, splitting the display name, ACTIVE for verified", async () => {
    const { repo, rows } = makeMemoryUserRepository();
    const authenticate = makeAuthenticate({ users: repo, clock: fixedClock });

    const user = await authenticate(identity());

    expect(user.firstName).toBe("Grace");
    expect(user.lastName).toBe("Brewster Hopper");
    expect(user.email).toBe("new.user@example.com");
    expect(user.firebaseUid).toBe("uid-1");
    expect(user.status).toBe("ACTIVE");
    expect(user.emailVerified).toBe(true);
    expect(rows.size).toBe(1);
  });

  it("provisions unverified password accounts as PENDING_VERIFICATION", async () => {
    const { repo } = makeMemoryUserRepository();
    const authenticate = makeAuthenticate({ users: repo, clock: fixedClock });

    const user = await authenticate(identity({ emailVerified: false, provider: "password" }));

    expect(user.status).toBe("PENDING_VERIFICATION");
  });

  it("derives a name from the email local part when the token has none", async () => {
    const { repo } = makeMemoryUserRepository();
    const authenticate = makeAuthenticate({ users: repo, clock: fixedClock });

    const user = await authenticate(
      identity({ email: "paul.smith@example.com", name: null }),
    );

    expect(user.firstName).toBe("Paul");
    expect(user.lastName).toBe("Smith");
  });

  it("links an existing email-matched account instead of creating a duplicate", async () => {
    const { repo, rows } = makeMemoryUserRepository();
    const authenticate = makeAuthenticate({ users: repo, clock: fixedClock });
    await authenticate(identity()); // first login provisions
    const before = [...rows.values()][0]!;

    const linked = await authenticate(identity({ uid: "uid-2" }));

    expect(linked.id).toBe(before.id); // same row — data preserved
    expect(linked.firebaseUid).toBe("uid-2");
    expect(rows.size).toBe(1);
  });

  it("matches by firebaseUid on subsequent logins and refreshes lastLogin", async () => {
    const { repo } = makeMemoryUserRepository();
    const authenticate = makeAuthenticate({ users: repo, clock: fixedClock });
    const created = await authenticate(identity());

    const later = makeAuthenticate({
      users: repo,
      clock: { now: () => new Date("2026-09-19T00:00:00Z") },
    });
    const user = await later(identity({ picture: "https://example.com/new.png" }));

    expect(user.id).toBe(created.id);
    expect(user.lastLogin).toEqual(new Date("2026-09-19T00:00:00Z"));
    expect(user.photoUrl).toBe("https://example.com/new.png");
  });
});
