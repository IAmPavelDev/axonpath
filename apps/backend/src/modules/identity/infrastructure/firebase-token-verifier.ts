import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type {
  FirebaseIdentity,
  TokenVerifier,
} from "@/modules/identity/ports/token-verifier";

/**
 * Verifies Firebase Auth ID tokens against Google's public JWKS — RS256
 * signature, `exp`, issuer `https://securetoken.google.com/<projectId>` and
 * audience `<projectId>`. No service-account credentials needed: the signing
 * keys are public.
 */
const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export type FirebaseTokenVerifierDeps = {
  projectId: string;
  /** Overridable for tests; defaults to Google's Firebase JWKS. */
  jwksUrl?: string;
};

const invalid = (detail: string) => ({
  kind: "InvalidToken" as const,
  detail,
});

export const makeFirebaseTokenVerifier = ({
  projectId,
  jwksUrl = FIREBASE_JWKS_URL,
}: FirebaseTokenVerifierDeps): TokenVerifier => {
  const JWKS = createRemoteJWKSet(new URL(jwksUrl));

  const verify = async (token: string): Promise<FirebaseIdentity> => {
    if (projectId.length === 0) {
      throw invalid(
        "Server is missing FIREBASE_PROJECT_ID; cannot verify tokens",
      );
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, JWKS, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
      }));
    } catch (err) {
      throw invalid(err instanceof Error ? err.message : "malformed token");
    }

    const { sub, email, email_verified, name, picture, firebase } = payload;
    if (typeof sub !== "string" || sub.length === 0) {
      throw invalid("token missing subject");
    }
    if (typeof email !== "string" || email.length === 0) {
      throw invalid("token missing email claim");
    }

    const signInProvider =
      typeof firebase === "object" &&
      firebase !== null &&
      "sign_in_provider" in firebase &&
      typeof firebase.sign_in_provider === "string"
        ? firebase.sign_in_provider
        : "unknown";

    return {
      uid: sub,
      email: email.toLowerCase(),
      emailVerified: email_verified === true,
      name: typeof name === "string" && name.length > 0 ? name : null,
      picture:
        typeof picture === "string" && picture.length > 0 ? picture : null,
      provider: signInProvider,
    };
  };

  return { verify };
};
