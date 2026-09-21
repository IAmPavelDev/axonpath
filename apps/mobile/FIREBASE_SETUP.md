# Firebase setup (mobile)

Auth uses the Firebase JS SDK (`firebase/auth`) with `EXPO_PUBLIC_FIREBASE_*`
vars from `.env`. Google sign-in additionally needs the `@react-native-google-signin/google-signin`
**native module**, which no JS-only install can provide.

## Dev build (required once, and after any native dependency change)

```sh
pnpm exec expo run:android   # from apps/mobile; builds, installs, starts Metro
```

- Expo Go will not work for Google sign-in: it cannot host third-party native
  modules. The login screen detects this and shows a hint instead of crashing.
- `pnpm run android` (`expo start`) only works once a dev build is installed
  (it contains `expo-dev-client`).
- The Gradle JVM is pinned to JDK 17 in `android/gradle.properties`
  (`org.gradle.java.home`); AGP's `JdkImageTransform` fails on the system
  default JDK 26. Remove/adjust if your toolchain changes.

## Firebase console (project axon-9e88e)

1. Authentication → Sign-in method → enable **Google**.
2. Project settings → Your apps → Android app `com.axon.app` → add the debug
   SHA-1, otherwise sign-in fails with `ApiException 10` (DEVELOPER_ERROR):

   ```
   5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
   ```

   (`apps/mobile/android/app/debug.keystore`, storepass `android`,
   alias `androiddebugkey`). Add a release SHA-1 the same way when shipping.
3. Authentication → Sign-in method → Google → copy the **Web client ID**
   (`...apps.googleusercontent.com`) into `EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Redbox: `RNGoogleSignin could not be found` | Installed binary predates the module — run `pnpm exec expo run:android` to rebuild. |
| `CommandError: No development build (com.axon.app)` from `pnpm run android` | Dev build not installed (or built without `expo-dev-client`) — run `pnpm exec expo run:android`. |
| In-app: `Google sign-in failed (10)` | Debug SHA-1 not registered in the Firebase console (see step 2). |
| In-app: `Google sign-in needs a development build` | Running in Expo Go, or the native module is missing — install the dev build. |
| In-app: `Google sign-in is not configured yet` | `EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID` empty in `.env` (restart Metro after editing `.env`). |
