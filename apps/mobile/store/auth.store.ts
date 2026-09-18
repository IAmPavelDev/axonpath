import { onIdTokenChanged, signOut, type User } from 'firebase/auth';
import { create } from 'zustand';
import { firebaseAuth, firebaseConfigMissing } from '@/lib/firebase';
import { getGoogleSignin } from '@/lib/google-signin';

export type AuthStatus = 'initializing' | 'signedIn' | 'signedOut';

type AuthStore = {
  status: AuthStatus;
  user: User | null;
  /**
   * Subscribe to Firebase's token stream (fires on sign-in, sign-out and
   * every silent token refresh). Call once at launch; returns unsubscribe.
   * Unconfigured projects resolve to signedOut so the app stays usable.
   */
  init: () => () => void;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthStore>((set) => ({
  status: 'initializing',
  user: null,
  init: () => {
    if (firebaseAuth === null || firebaseConfigMissing) {
      set({ status: 'signedOut', user: null });
      return () => {};
    }
    return onIdTokenChanged(firebaseAuth, (user) => {
      set({ status: user ? 'signedIn' : 'signedOut', user });
    });
  },
  signOut: async () => {
    // Clears the Google account picker state so the next "Continue with
    // Google" offers account choice again; a no-op when signed in by
    // email/password or when the native module is absent (Expo Go).
    const googleSignin = getGoogleSignin();
    if (googleSignin) {
      try {
        await googleSignin.signOut();
      } catch {
        // Not signed in via Google — nothing to revoke.
      }
    }
    if (firebaseAuth) {
      await signOut(firebaseAuth);
    }
  },
}));
