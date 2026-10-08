# Axon — Gap Ledger

> **Status 2026-10-02** — all 15 rows closed (8 via Phase 7 S1; 10 and 13 via Phase 7 S6+S7,
> same day; S3–S5 landed the same day per `knowledge-base/PHASE7_POST_BETA.md` — this file's
> header was stale on that point). This file was the 2026-09 gap analysis (pre-refactor file
> references). All beta and post-beta gaps are closed; the post-backlog first levers
> (BUSINESS_DECISIONS §4) landed 2026-10-01: AI token capture + `usage.report` (§4.2) and
> `stats.overview` + `skill.mistakes` (§4.3) — feature work, not gap closures. Current-state
> detail: `knowledge-base/ARCHITECTURE.md`; beta history: `knowledge-base/BETA_PLAN.md`.

## Status summary

| # | Gap (original priority) | Status |
|---|---|---|
| B1 | 🔴 Adaptive loop not implemented | ✅ CLOSED (Phase 3+4, 2026-09-21) — `generate-next-class`, history RAG, status lifecycle; 10 unit tests |
| B2 | 🟢 Vector memory write+retrieve | ✅ CLOSED — `AI_INITIAL` + `AI_NEXT` written; retrieval feeds init (excluded) and next-class (included, topK 12). `ANSWER_DERIVED` shipped (Phase 7 S3) |
| 3 | 🟠 No real authentication | ✅ CLOSED — Firebase email/password + Google, per-request ID-token verification, `context.user` |
| 4 | 🟠 No create-skill UI | ✅ CLOSED — create flow + description screen + skill list/detail |
| 5 | 🟠 Quiz submit dead | ✅ CLOSED — scored vs server-side `answerKey`, `Answer` rows, real result UI, `ANSWER_SUBMITTED` events |
| 6 | 🟠 Fire-and-forget gen unobservable | ✅ CLOSED — `GENERATING` on create; `ACTIVE`/`FAILED` + `ERROR_OCCURRED` on init end; mobile preparing state |
| 7 | 🟡 Status never advanced | ✅ CLOSED — `canTransition` state machine, migrations + DRAFT backfill. lifecycle UX shipped (Phase 7 S2) |
| 8 | 🟡 No progress tracking | ✅ CLOSED (Phase 7 S1, 2026-09-30) — skill.progress derived query + per-lesson progress UI |
| 9 | 🟡 Answer flow incomplete | ✅ CLOSED for beta — scoring + persistence done; `ANSWER_DERIVED` shipped (Phase 7 S3) |
| 10 | 🟡 Dead config | ✅ CLOSED (Phase 7 S6+S7, 2026-09-30) — rabbitmq deleted from dev compose; lambda surface deleted |
| 11 | 🟡 Errors not surfaced | ✅ CLOSED — `skill.retry` route (NotOwned 404 / InvalidTransition 409) + mobile FAILED chip, retry affordance, and detail banner |
| 12 | 🟡 No tests | ✅ CLOSED — 15 files / 86 tests green, incl. the composed loop integration test (real use cases + in-memory fakes) and the next-class worker/sweeper/reconciler tests |
| 13 | 🟢 Non-transactional pipeline | ✅ CLOSED (Phase 7 S6, 2026-09-30) — createWithQuestions single $transaction |
| 14 | 🟢 Mobile polish | ✅ CLOSED — `EXPO_PUBLIC_API_URL` overrides the RPC base URL (platform defaults preserved) |
| 15 | 🟢 Build/dev reproducibility | ✅ CLOSED — backend emits `dist/` (tsc + module-alias, nodenext), Dockerfile `production` stage, compose fixed; image boots `/health` with migrations applied |

---

## Original analysis (2026-09, superseded file references; kept for rationale)

## 🔴 B1. The adaptive loop is not implemented
- **Impact:** The product's entire point ("AI builds the next lesson from what you got wrong").
- **Acceptance (beta):** answering a quiz produces a new, adapted lesson that references the
  user's mistakes, end-to-end. → **Met 2026-09-21** (unit-tested; live-stack smoke pending in
  Phase 6).

## 🟢 B2. Vector memory — write + retrieve
Qdrant `axon_vectors` (3072, Cosine); Postgres keeps relational metadata only. Remaining
`ANSWER_DERIVED` shipped (Phase 7 S3).

## 🟠 3. No real authentication → closed (Firebase)

## 🟠 4. Create-skill has no UI path → closed

## 🟠 5. Quiz submit is dead → closed

## 🟠 6. Fire-and-forget AI gen is unobservable → closed via status lifecycle

## 🟡 7. Skill status is never advanced → closed (see BETA_PLAN §Phase 3+4)


## 🟡 8. No progress tracking → closed (Phase 7 S1: skill.progress + per-lesson UI)

## 🟡 10. Hard-coded / dead config → closed (Phase 7 S6+S7: rabbitmq + lambda deleted)

## 🟡 11. Errors are not surfaced to the client → closed (Phase 6: FAILED UX + retry)

## 🟡 12. No tests → closed (Phase 6: loop integration test; 64 green)

## 🟢 13. Non-transactional background pipeline → closed (Phase 7 S6: createWithQuestions $transaction)

## 🟢 14. Mobile polish & config → closed (Phase 6: EXPO_PUBLIC_API_URL)

## 🟢 15. Build/dev reproducibility → closed (Phase 6: prod image + compose)


## 🟠 16. Android package renamed for beta — production identity decision

Beta-only rename `com.axon.app` → `com.iampauld3v.axon` (2026-10-08, dev branch):
Google Play Protect flagged the generic `com.axon.app` + self-signed cert as a
possible imitation app on every sideload install. Touch points when going to
production: (a) Play Store package is PERMANENT — either keep
`com.iampauld3v.axon` as the final identity (recommended; already live on
devices) or rename once more before the first store upload, never after;
(b) old `com.axon.app` installs do NOT receive updates — manual reinstall of the
final build; (c) Firebase auth is the JS SDK (API-key based), so no Firebase
console change was needed or is needed later; (d) iOS `bundleIdentifier` still
`com.axon.app` (untouched) — align it in the same production pass if iOS ships.
