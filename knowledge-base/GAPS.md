# Axon — Gap Ledger

> **Status 2026-09-22.** This file was the 2026-09 gap analysis (pre-refactor file
> references). All beta gaps are closed; the open/partial items (8, 10, 13) are planned as
> **Phase 7** — execution authority `knowledge-base/PHASE7_POST_BETA.md`. Current-state
> detail: `knowledge-base/ARCHITECTURE.md`; beta history: `knowledge-base/BETA_PLAN.md`.

## Status summary

| # | Gap (original priority) | Status |
|---|---|---|
| B1 | 🔴 Adaptive loop not implemented | ✅ CLOSED (Phase 3+4, 2026-09-21) — `generate-next-class`, history RAG, status lifecycle; 10 unit tests |
| B2 | 🟢 Vector memory write+retrieve | ✅ CLOSED — `AI_INITIAL` + `AI_NEXT` written; retrieval feeds init (excluded) and next-class (included, topK 12). `ANSWER_DERIVED` → post-beta |
| 3 | 🟠 No real authentication | ✅ CLOSED — Firebase email/password + Google, per-request ID-token verification, `context.user` |
| 4 | 🟠 No create-skill UI | ✅ CLOSED — create flow + description screen + skill list/detail |
| 5 | 🟠 Quiz submit dead | ✅ CLOSED — scored vs server-side `answerKey`, `Answer` rows, real result UI, `ANSWER_SUBMITTED` events |
| 6 | 🟠 Fire-and-forget gen unobservable | ✅ CLOSED — `GENERATING` on create; `ACTIVE`/`FAILED` + `ERROR_OCCURRED` on init end; mobile preparing state |
| 7 | 🟡 Status never advanced | ✅ CLOSED — `canTransition` state machine, migrations + DRAFT backfill. PAUSED/COMPLETED UX → post-beta |
| 8 | 🟡 No progress tracking | 🕓 OPEN (post-beta) — list query already computes lessonCount/completedLessons/learnedPoints; no dedicated progress UI/aggregation |
| 9 | 🟡 Answer flow incomplete | ✅ CLOSED for beta — scoring + persistence done; `ANSWER_DERIVED` vectors → post-beta |
| 10 | 🟡 Dead config | 🔶 PARTIAL — amqplib/queue code removed; unused `rabbitmq` container still declared in dev compose; `lambda` unused |
| 11 | 🟡 Errors not surfaced | ✅ CLOSED — `skill.retry` route (NotOwned 404 / InvalidTransition 409) + mobile FAILED chip, retry affordance, and detail banner |
| 12 | 🟡 No tests | ✅ CLOSED — 15 files / 86 tests green, incl. the composed loop integration test (real use cases + in-memory fakes) and the next-class worker/sweeper/reconciler tests |
| 13 | 🟢 Non-transactional pipeline | 🔶 PARTIAL — init retry guard shipped (skip-if-class-exists; retries can never corrupt a skill); pipeline itself still non-transactional → post-beta |
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
`ANSWER_DERIVED` vectors → post-beta.

## 🟠 3. No real authentication → closed (Firebase)

## 🟠 4. Create-skill has no UI path → closed

## 🟠 5. Quiz submit is dead → closed

## 🟠 6. Fire-and-forget AI gen is unobservable → closed via status lifecycle

## 🟡 7. Skill status is never advanced → closed (see BETA_PLAN §Phase 3+4)

## 🟡 8. No progress tracking — open, post-beta

## 🟡 9. Answer schema/flow incomplete → closed for beta

## 🟡 10. Hard-coded / dead config — partial (rabbitmq container, lambda)

## 🟡 11. Errors are not surfaced to the client → closed (Phase 6: FAILED UX + retry)

## 🟡 12. No tests → closed (Phase 6: loop integration test; 64 green)

## 🟢 13. Non-transactional background pipeline → partial (retry-safety done; transactionality post-beta)

## 🟢 14. Mobile polish & config → closed (Phase 6: EXPO_PUBLIC_API_URL)

## 🟢 15. Build/dev reproducibility → closed (Phase 6: prod image + compose)

