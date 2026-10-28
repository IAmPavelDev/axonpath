# Axon Android (Kotlin/Compose) — agent rules

## Hard rules
- The TTS model (Kokoro, ~152MB) must NEVER be committed or placed in `assets/`.
  It is downloaded to `filesDir` on first run.
- `packages/api-contract` is the API contract source of truth. NEVER hand-write
  request paths or payload shapes: the Retrofit client is GENERATED from the
  committed `packages/api-contract/openapi.json` by the gradle `openApiGenerate`
  task (`build/generated/openapi` → `com.iampavlo.axon.data.generated.*`, not
  committed). Changing the API means: schema/routes.ts in the contract package →
  `pnpm --filter @axon/api-contract build` → rebuild; map generated models to
  UI dtos only inside `data/api/AxonApi.kt`.

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
- The wire contract is the generated client (`data.generated.*`); UI code uses
  `data/dto/Dtos.kt` and never imports generated models outside the
  `data/api/AxonApi.kt` facade. Ids/enum `.value` mapping lives only there.
- Colors: single source `core/ui/theme/AxonColors` — mirrors RN `lib/theme.ts`.
  Do not hardcode colors in screens.
- Release builds: R8 on, `arm64-v8a` only (see plan: TTS phase adds the filter).
