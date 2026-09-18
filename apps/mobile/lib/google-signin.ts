import type { GoogleSignin } from '@react-native-google-signin/google-signin';

// Firebase console → Authentication → Google → "Web client ID"
// (.env: EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID, see FIREBASE_SETUP.md).
const FIREBASE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID ?? '';

/**
 * Google sign-in needs its native module, which Expo Go cannot host. The
 * require stays lazy so bundling/importing never touches native: in Expo Go
 * the login screen reports "needs a dev build" instead of crashing.
 */

let configured = false;

export const googleSignInConfigured = (): boolean =>
  FIREBASE_WEB_CLIENT_ID.length > 0;

/** Native GoogleSignin handle, or null when the native module is absent. */
export const getGoogleSignin = (): typeof GoogleSignin | null => {
  try {
    // require() is untyped; the cast is the typing seam for a lazy native module.
    const GoogleSigninModule = require(
      '@react-native-google-signin/google-signin',
    ) as { GoogleSignin: typeof GoogleSignin };
    if (!configured && FIREBASE_WEB_CLIENT_ID.length > 0) {
      GoogleSigninModule.GoogleSignin.configure({
        webClientId: FIREBASE_WEB_CLIENT_ID,
        offlineAccess: false,
      });
      configured = true;
    }
    return GoogleSigninModule.GoogleSignin;
  } catch {
    // Native module missing (Expo Go) — caller shows a setup hint.
    return null;
  }
};
