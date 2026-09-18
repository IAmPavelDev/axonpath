import { describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { makeFirebaseTokenVerifier } from "./firebase-token-verifier";
import { isTaggedError } from "@/modules/platform/errors";

const PROJECT_ID = "test-project";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;

/** Serves the public key as a `data:` URL JWKS — no network, no server.
 *  `kid` must match the token header; `alg`/`use` must mark it RSA-signing. */
const jwksDataUrl = async (publicKey: CryptoKey): Promise<string> => {
  const jwk = await exportJWK(publicKey);
  const json = JSON.stringify({
    keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
  });
  return `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
};
const signToken = async (
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  overrides: { issuer?: string; audience?: string; expiry?: string } = {},
): Promise<string> =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? PROJECT_ID)
    .setIssuedAt()
    .setExpirationTime(overrides.expiry ?? "1h")
    .setSubject("firebase-uid-1")
    .sign(privateKey);

const PASSWORD_CLAIMS = {
  email: "Jane.Doe@Example.com",
  email_verified: true,
  name: "Jane Doe",
  picture: "https://example.com/jane.png",
  firebase: { sign_in_provider: "password" },
};

describe("firebaseTokenVerifier", () => {
  it("verifies a signed token and maps claims", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const verifier = makeFirebaseTokenVerifier({
      projectId: PROJECT_ID,
      jwksUrl: await jwksDataUrl(publicKey),
    });

    const identity = await verifier.verify(await signToken(privateKey, PASSWORD_CLAIMS));

    expect(identity).toEqual({
      uid: "firebase-uid-1",
      email: "jane.doe@example.com",
      emailVerified: true,
      name: "Jane Doe",
      picture: "https://example.com/jane.png",
      provider: "password",
    });
  });

  it("rejects a token signed by a key that is not in the JWKS", async () => {
    const { publicKey } = await generateKeyPair("RS256");
    const { privateKey: otherKey } = await generateKeyPair("RS256");
    const verifier = makeFirebaseTokenVerifier({
      projectId: PROJECT_ID,
      jwksUrl: await jwksDataUrl(publicKey),
    });

    await expect(verifier.verify(await signToken(otherKey, PASSWORD_CLAIMS))).rejects.toMatchObject({
      kind: "InvalidToken",
    });
  });

  it("rejects a token issued for another project (audience mismatch)", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const verifier = makeFirebaseTokenVerifier({
      projectId: PROJECT_ID,
      jwksUrl: await jwksDataUrl(publicKey),
    });

    const token = await signToken(privateKey, PASSWORD_CLAIMS, { audience: "other-project" });
    const err = await verifier.verify(token).catch((e) => e);
    expect(isTaggedError(err) && err.kind === "InvalidToken").toBe(true);
  });

  it("rejects a token from a foreign issuer", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const verifier = makeFirebaseTokenVerifier({
      projectId: PROJECT_ID,
      jwksUrl: await jwksDataUrl(publicKey),
    });

    const token = await signToken(privateKey, PASSWORD_CLAIMS, {
      issuer: "https://securetoken.google.com/other-project",
    });
    await expect(verifier.verify(token)).rejects.toMatchObject({ kind: "InvalidToken" });
  });

  it("rejects an expired token", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const verifier = makeFirebaseTokenVerifier({
      projectId: PROJECT_ID,
      jwksUrl: await jwksDataUrl(publicKey),
    });

    const token = await signToken(privateKey, PASSWORD_CLAIMS, { expiry: "-1h" });
    await expect(verifier.verify(token)).rejects.toMatchObject({ kind: "InvalidToken" });
  });

  it("rejects a token without an email claim", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const verifier = makeFirebaseTokenVerifier({
      projectId: PROJECT_ID,
      jwksUrl: await jwksDataUrl(publicKey),
    });

    const token = await signToken(privateKey, { email_verified: true });
    await expect(verifier.verify(token)).rejects.toMatchObject({
      kind: "InvalidToken",
      detail: "token missing email claim",
    });
  });

  it("fails closed when the project id is not configured", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const verifier = makeFirebaseTokenVerifier({
      projectId: "",
      jwksUrl: await jwksDataUrl(publicKey),
    });

    const token = await signToken(privateKey, PASSWORD_CLAIMS);
    const err = await verifier.verify(token).catch((e) => e);
    expect(isTaggedError(err) && err.kind === "InvalidToken").toBe(true);
    expect(isTaggedError(err) && err.detail?.includes("FIREBASE_PROJECT_ID")).toBe(true);
  });
});
