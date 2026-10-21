# Axon Android — Architecture

Kotlin 2.2 + Jetpack Compose (Material 3), single `:app` module, manual DI.
Rewrite of `apps/mobile` (React Native, frozen reference) for Android-only.

## Package layout

```
com.iampavlo.axon
├── AxonApp.kt              # Application; owns AppContainer
├── MainActivity.kt         # single activity, Compose NavHost
├── core/
│   ├── di/AppContainer.kt  # manual dependency graph
│   ├── ui/theme/           # AxonColors, Typography, AxonTheme (ported tokens)
│   ├── network/            # OkHttp (+ auth interceptor), OrpcClient (batch RPC)
│   ├── auth/               # SessionManager: FirebaseAuth IdTokenListener → StateFlow
│   └── tts/                # sherpa-onnx driver, model download, word mapping (TTS phase)
├── data/
│   ├── dto/                # kotlinx-serialization DTOs mirroring @axon/api-contract
│   └── repo/               # SkillsRepo, LessonsRepo, ... (thin, over OrpcClient)
└── feature/
    ├── login/  home/  skillcreate/  lesson/  quiz/  settings/
    └── (screen .kt + state holder .kt per feature)
```

## Data flow

```
Composable → StateHolder (feature) → Repo → OrpcClient (OkHttp) → Lambda /rpc
                    ↑                       ↑
              StateFlow<UiState>      AuthInterceptor: Bearer getIdToken()
SessionManager: FirebaseAuth.addIdTokenListener → StateFlow<AuthStatus>
  { initializing, signedIn(user), signedOut } — drives nav gating exactly like
  the RN onIdTokenChanged subscription (token refresh must not bounce the UI).
```

- Backend endpoint: `{API_URL}/rpc`, oRPC RPCLink + batch plugin semantics
  (parallel calls buffered into one HTTP round trip). Wire envelope documented
  in `docs/MIGRATION_PLAN.md` appendix once ApiSpec scout report is merged.
- No local database. Server state is source of truth; DataStore holds
  preferences only (theme mode, pins).
- Theme mode: DataStore key `axon.theme-mode` (`system|light|dark`), same
  semantics as RN `lib/theme-mode.ts`.

## Conventions
- Colors/typography: only via `MaterialTheme` + `LocalExtendedColors`
  (`core/ui/theme/`). `AxonColors` mirrors RN `lib/theme.ts` HSL tokens 1:1 —
  the lockstep-checker script has no Kotlin counterpart; discipline is manual.
- Fonts: Source Sans 3 bundled in `res/font` (400/500/600/700), one
  `FontFamily` with weight mapping — RN picked faces by exact weight; here
  weight resolution does it.
- Errors: RPC errors surface as sealed `RpcError` → per-feature UI states; auth
  error-code mapping ported verbatim from RN `AUTH_ERRORS`.

## Known platform deltas vs RN
- Word-sync TTS: sherpa-onnx official Android AAR (Kotlin API) replaces the
  XDcobra TurboModule; model loads from `filesDir`, not assets.
- Crashlytics requires the `com.google.firebase.crashlytics` Gradle plugin
  (build ID injection) — omitting it crashes at startup.
- arm64-v8a-only release: x86_64 emulators cannot load the sherpa libs; TTS
  testing needs a physical device.
