/**
 * Identity for a Firebase Auth user, extracted from a verified ID token.
 * `uid` is the stable Firebase identifier; `email` is the natural join key
 * for pre-existing local accounts.
 */
export type FirebaseIdentity = {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  provider: string;
};

export type TokenVerificationError = {
  kind: "InvalidToken";
  detail?: string;
};

export type TokenVerifier = {
  /**
   * Verifies signature, expiry, issuer and audience. Rejects with
   * `TokenVerificationError` (tagged) — never leaks underlying causes.
   */
  verify(token: string): Promise<FirebaseIdentity>;
};
