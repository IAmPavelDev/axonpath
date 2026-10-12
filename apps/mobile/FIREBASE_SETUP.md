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
   alias `androiddebugkey`).

   EAS builds (sideloaded APK / Play AAB) sign with the EAS-managed keystore,
   not the debug one — register its fingerprints too (`eas credentials -p android`
   → Build Credentials → Keystore):

   ```
   CB:3B:5A:6F:61:67:6A:63:59:D3:B6:C7:23:1C:EA:C9:70:10:4B:49
   EE:AF:BD:F6:39:42:9C:6E:91:AF:1B:2F:97:62:FD:72:4B:86:72:52:63:7A:2A:4F:11:DC:EE:CE:54:B7:82:5A
   ```
3. Authentication → Sign-in method → Google → copy the **Web client ID**
   (`...apps.googleusercontent.com`) into `EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID`.

## Crashlytics (crash + error reporting, 2026-10-10)

Replaced Sentry. `@react-native-firebase` v26 (app + crashlytics + analytics,
TurboModules — requires the New Architecture, which this app enables). Wired:

- `app.json`: `expo.android.googleServicesFile` + the three RNFirebase
  plugins; `firebase.json` sets
  `crashlytics_javascript_exception_handler_chaining_enabled: false`
  (docs-recommended: on-by-default chaining duplicates release crashes without
  the JS stack).
- The Crashlytics module installs the global JS exception handler itself —
  unhandled JS exceptions are recorded as fatal crashes with JS stack frames,
  unhandled promise rejections as non-fatals (release builds only).
- `store/auth.store.ts` binds `setUserId` (Crashlytics + Analytics) to the
  Firebase uid on every auth change.

One-time console steps (project axon-9e88e):

1. Project settings → Your apps → **Add app → Android**, package
   `com.iampauld3v.axon` → download `google-services.json` → save as
   `apps/mobile/google-services.json` (committed; contains no secrets).
2. Settings → Integrations → **Google Analytics → enable** (feeds Crashlytics
   breadcrumbs; Analytics itself then gives DAU/retention for free).
3. Apply the native changes (EAS does **not** prebuild the committed
   `android/` dir):

   ```sh
   npx expo prebuild -p android --no-clean   # from apps/mobile
   git checkout -- android/app/src/main/res/mipmap-* android/gradle.properties
   ```

   (the second line reverts the launcher-icon/whitespace churn prebuild
   always regenerates).
4. Rebuild + install (`pnpm exec expo run:android` or `eas build -p android
   --profile preview`), then verify: Firebase console → **Crashlytics** →
   force a test crash (`crash(getCrashlytics())` on a temp button) → restart
   the app → report appears in ~5 min.

Gotchas: the Crashlytics Gradle plugin is mandatory — without it the app
crashes at startup ("Crashlytics build ID missing"). Debug builds don't
upload by default; expo-dev-client swallows native crashes during dev — test
on the preview/release APK. Android R8 mappings are uploaded automatically by
the Gradle plugin (no dSYM-style step on Android).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Redbox: `RNGoogleSignin could not be found` | Installed binary predates the module — run `pnpm exec expo run:android` to rebuild. |
| `CommandError: No development build (com.axon.app)` from `pnpm run android` | Dev build not installed (or built without `expo-dev-client`) — run `pnpm exec expo run:android`. |
| In-app: `Google sign-in failed (10)` | Signing-cert SHA-1 missing in the Firebase console — debug keystore for local dev builds, EAS keystore for sideloaded EAS builds (see step 2). |
| In-app: `Google sign-in needs a development build` | Running in Expo Go, or the native module is missing — install the dev build. |
| In-app: `Google sign-in is not configured yet` | `EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID` empty in `.env` (restart Metro after editing `.env`). |
