import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  type Auth,
  type Persistence,
} from 'firebase/auth';

// Firebase console → Project settings → General → "Web app" SDK setup and
// configuration. Fed via .env as EXPO_PUBLIC_FIREBASE_* (see FIREBASE_SETUP.md).
// The backend independently needs FIREBASE_PROJECT_ID to verify tokens.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

/** True until the env vars above are filled in — the app runs, auth is inert. */
export const firebaseConfigMissing =
  firebaseConfig.apiKey.length === 0 ||
  firebaseConfig.projectId.length === 0 ||
  firebaseConfig.appId.length === 0;

// firebase v12's public typings omit the persistence helper that its
// react-native build exports at runtime; require() is the typing seam here.
const { getReactNativePersistence } = require('firebase/auth') as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

// initializeAuth() throws if called twice (Fast Refresh re-evaluates this
// module); fall back to the already-initialized instance.
let auth: Auth | null = null;
if (!firebaseConfigMissing) {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    auth = getAuth(app);
  }
}

export const firebaseAuth: Auth | null = auth;
