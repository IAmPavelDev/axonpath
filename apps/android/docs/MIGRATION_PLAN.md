# Axon Android Migration Plan

RN (`apps/mobile`) is frozen and used strictly as reference. This document is
the single source of migration status; update it in the same change that lands
a phase.

## Decisions (settled)
| Decision | Choice | Why |
|---|---|---|
| Stack | Kotlin 2.2 + Compose M3, single module | Android-only; no runtime tax; most AI/human-known Android stack |
| applicationId | `com.iampavlo.axon` (same) + committed debug.keystore as `storeFile` | deterministic SHA-1 on every machine; needs its fingerprint registered on the Firebase Android app (one console step) |
| TTS model | download-on-first-run to `filesDir` | APK ~10MB vs ~160MB; repo stays small |
| API | Retrofit + kotlinx.serialization over oRPC `/rpc` batch endpoint | contract package untouched, DTOs mirror it |
| DI | manual `AppContainer` | app is small; no codegen |
| Release | R8 + shrinkResources, `arm64-v8a` only | bundle size goal |

## Phases
| # | Phase | Status |
|---|---|---|
| 1 | Recon: env (SDK/JDK/gradle cache), RN reference specs | done |
| 2 | Docs (this file, AGENTS, ARCHITECTURE) | done |
| 3 | Skeleton: Gradle project, wrapper, first assembleDebug | done |
| 4 | Core: theme tokens, OrpcClient + DTOs, AppContainer, SessionManager | done |
| 5 | Auth: Credential Manager + email/password, LoginScreen, nav gating | done |
| 6 | Features: home (pins), skill create flow, skill detail, conspect reader (markdown + QA + anchor), quiz, settings, video player | done |
| 7 | TTS: sherpa AAR, model download, word-boundary scroll-follow | done — emulator-verified: download, extract, Kokoro init (FP32 fallback), word pill, scroll-follow; user-phone audio pass pending |
| 8 | Parity: R8 + arm64 done; Google sign-in error handling fixed + emulator-verified; insets fixed + verified; video player hardened (ready-gate, spinner, error-revert, retry); analytics events + long-press selection ask landed (unit-tested, emulator pass pending) | in progress — release signing + phone sweep pending |

## Open items / risks log
- sherpa AAR is gitignored; fetch once after cloning:
  `curl -L -o apps/android/app/libs/sherpa-onnx-1.13.8.aar https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-1.13.8.aar`
- [ ] Real release keystore decision (currently debug-signed release for
  migration installs). Committed debug keystore SHA-1 (used by both build
  types since the storeFile fix): `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`.
- [ ] Google sign-in on local builds is BROKEN until one console step:
  Firebase only has the old EAS-build keystore (`8d6cb4d8…`) for
  `com.iampavlo.axon`, so Credential Manager throws NoCredentialException
  ("no Google account on this device"). Fix = Firebase console → Project
  settings → the `com.iampavlo.axon` Android app → Add fingerprint with the
  SHA-1 above → re-download google-services.json into `apps/android/app/` →
  uninstall the previous install once (signing cert changed from
  `~/.android/debug.keystore` to the committed keystore) → rebuild.
- [ ] Emulator caveat: WebView video renderer crashes under SwiftShader
  (GPU emulation) — video embeds need a real device to verify. RN used the
  identical WebView mechanism, so phone behavior is expected to match RN.
- [x] Long-press-selection "Ask AI": long-press a word → its sentence is
  selected (highlight wash) → bottom-center ✕/Ask AI pill → composer with
  the verbatim sentence as excerpt + anchorText. Compose has no custom
  selection-menu hook, so the pill replaces RN's native menu item and the
  granularity is sentence-level (RN: arbitrary drag selection).
- [x] Analytics events port: login/class_view/conspect_read/quiz_opened/
  quiz_completed/lesson_opened + screen_view tracking via
  core/analytics/Analytics (Firebase logEvent, best-effort like RN
  lib/analytics.ts). quizFocusAt moved to quiz-tab open (RN parity), so
  per-answer timing + quiz_completed measure the quiz session itself.
- Environment note: Gradle/AGP/deps verified downloadable 2026-10-17. If DNS
  errors appear while the Tailscale exit node is up — known accepted
  constraint, report, don't touch Tailscale.
- [ ] Scroll-follow comfort bands (FOLLOW_TOP 120 / FOLLOW_BOTTOM 96, land at
  1/3 viewport) need one on-device tuning pass.

## Parity checklist (from RN reference)
- Auth: email/password sign-in + signup (displayName join), Google via
  Credential Manager, exact `AUTH_ERRORS` mapping, sign-out clears Google
  account picker first, missing-config degrade (auth inert, setup hint).
- Analytics events: `login{method}`, `class_view{class_id,skill_id}`,
  `conspect_read{class_id,seconds,scroll_progress}`,
  `quiz_opened{class_id,seconds_since_class_view}`,
  `quiz_completed{class_id,seconds,correct}`,
  `lesson_opened{class_id,seconds_since_created}`; setUserId on
  crashlytics+analytics bound to IdTokenListener (empty on sign-out).
- Session: splash until first auth emission; signedIn graph gated; token
  refresh does not bounce UI; settings shows email + sign-out.
- Theme: 21 semantic tokens × light/dark (see `AxonColors`), mode persisted
  `axon.theme-mode`, settings Light/Dark segmented control.
- Skill flow: prompt textarea → metadata generation (1s poll) → edit/accept →
  first lesson generation (detail polls 10s, skeleton row while GENERATING).
- Reader: markdown + code highlight, chunked QA groups with optimistic ask +
  1.6s pending poll, anchor mode + composer (4000 chars), stale-anchor tail
  group, video clips with sponsor-segment skip, clip-gate while PENDING (5s
  poll), collapsing title (140px span), scroll progress bar, pins on skill
  rows (long-press), skill retry pills.
- Quiz: one-page, MCQ/TF inverted tiles, open-ended textarea, per-answer
  timeSpentMs, result poll 4s while grading (5 min cap), Continue → skill.
- TTS (phase 7): Kokoro on-device for English, system TTS otherwise,
  permanent degrade on Kokoro failure, word highlight, scroll-follow bands,
  djb2 content-hash wav cache, model on first run.
