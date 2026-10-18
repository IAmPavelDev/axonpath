# Axon Android (Kotlin/Compose) — agent rules

## Hard rules
- `apps/mobile` (React Native) is a **frozen reference**. NEVER edit, delete, or
  move anything in it. Read/copy from it freely as the source of truth for
  behavior parity.
- The TTS model (Kokoro, ~152MB) must NEVER be committed or placed in `assets/`.
  It is downloaded to `filesDir` on first run.
- Backend (`apps/backend`) and `packages/api-contract` are shared with the RN
  app: contract changes there are out of scope here; mirror, don't mutate.

## Docs map
- `docs/MIGRATION_PLAN.md` — phase table, decisions, parity checklist. Update
  statuses in the same change that lands a phase.
- `ARCHITECTURE.md` — package layout, data flow, conventions.
- `gradle/libs.versions.toml` — single source for all dependency versions.

## Commands
- Build: `./gradlew :app:assembleDebug` (from `apps/android/`)
- Release: `./gradlew :app:assembleRelease`
- Unit tests: `./gradlew :app:testDebugUnitTest`
- Install on connected device: `adb install -r app/build/outputs/apk/debug/app-debug.apk`

## Conventions
- Feature-first packages: `feature/<name>/` holds screen + state holder;
  `core/` holds theme, network, auth, DI, TTS infra.
- One screen per file. Manual DI via `AppContainer` (no Hilt).
- DTOs mirror `packages/api-contract` TypeScript types 1:1 (names and shapes);
  the contract package stays the source of truth.
- Colors: single source `core/ui/theme/AxonColors` — mirrors RN `lib/theme.ts`.
  Do not hardcode colors in screens.
- Release builds: R8 on, `arm64-v8a` only (see plan: TTS phase adds the filter).
