# Axon — Roadmap to Beta (3–4 weeks)
> **SUPERSEDED for execution:** follow `knowledge-base/BETA_PLAN.md` (2026-09-17, verified
> against the post-DDD-refactor code). File paths below cite pre-refactor files that no longer
> exist. Kept for background rationale only.
> Goal: a **single-author workable beta** proving the adaptive loop, usable by someone other than
> the developer. Scope is deliberately tight — the loop is the product; everything else is
> hardening or deferral. Driven from ARCHITECTURE.md (current state), CONCEPT.md (vision),
> GAPS.md (the delta).

## Principles for this push
1. **Deliver the adaptive loop first.** A read→quiz→personalized-next-lesson cycle that actually
   runs is a beta. UI/observability around it is second.
2. **Solve auth last among the criticals, and only "light."** One real user (or minimal email/pw)
   is enough; multi-tenant can wait.
3. **Ship a whole vertical slice each week** — backend + contract + mobile + test working together —
   not "backend first, UI never."
4. **Delete dead weight** (OpenSearch/AWS config, unused lambdas) as you touch it — don't wire it.

---

## Week 1 — Foundation: make the existing loop observable and safe

**Goal:** today's working happy path, hardened so a user can trust it.
[GAPS 6, 7, 10, 13, 15]

- **Reproduce & lock the build.** Get the stack booting deterministically; single documented
  `pnpm dev`. Verify `api-contract` build → backend resolves. (GAPS 15)
- **Status lifecycle** 🔴: `SkillStatus` transitions + a status channel.
  - Add `GENERATING` (or reuse `DRAFT→ACTIVE` with a clean definition). Persist per-skill state so
    the client can poll: `skill.create` returns id; client polls `skill.getStatus(id)` until
    `ACTIVE` or `ERROR`.
  - Replace blind `runDetached` fire-and-forget with a managed record of the job (or RabbitMQ) so
    generation is retryable and its outcome is visible. **Decision point below.**
- **Error surfacing** 🟠: map AI/DB failures to a typed error the client can show; flip
  `DRAFT → ERROR` on failure so the user can retry.
- **Harden the init pipeline** 🟢: wrap class/questions/vectors creation in a transaction; make
  retries idempotent.
- **Config cleanup** 🟡: remove dead `vectorDb.endpoint`/`aws.region` placeholders and unused
  OpenSearch deps; pull the RabbitMQ URL from env (or delete the queue if unused).
- **Smoke test:** create a skill → assert it lands `ACTIVE` with exactly 1 class + N questions +
  vectors, and that a genuinely failing generation produces an `ERROR` state. (**GAPS 12** starts.)

**Decision A (RabbitMQ):** migrate `runDetached` → RabbitMQ jobs for durability OR keep in-process
but add persistence/status. Recommendation: **keep it in-process** for the 4 weeks (simplest, one
deployable), but structure the job as a small, testable unit that could move to the queue later.
Don't let the queue be a bootstrap risk.

**Definition of done W1:** create a skill from an API call, wait, and see `ACTIVE` with content; a
forced AI failure shows `ERROR` and can be retried. Integration test covers it.

---

## Week 2 — Close the adaptive loop

**Goal:** answer a quiz → AI generates the next, personalized class. [GAPS #1, #5, #9]

- **Wire `quiz.submit` end-to-end** 🟠:
  - Schemas exist (`SubmitQuizAnswersInput/Output`); export the `submit` procedure from
    `quizContract`, then wire the router. The controller (`submitQuizHandler`) is already written
    as dead code in `controllers/quiz.controller.ts:22` — reuse it, don't rewrite it.
  - `submitAnswers` must actually **score**: compare `Question.answerKey` (keep the keys server-side;
    only hide them from `.get` output) and **record `Answer` rows** (content, `score`, `isCorrect`,
    `timeSpentMs`).
  - Return a real result (total score, per-question correctness) — update the submit output schema.
- **Write retrieval** 🔴: ~~add vector search over `pgvector`~~ — **done**: vectors moved to Qdrant
  (collection `axon_vectors`); `searchSimilar` (filtered by `userId`) feeds prior user context into
  `generateInitSkill`. Next step is binding retrieval into `generateNextClass` for per-class, per-user
  personalization.
- **Re-enable `generateNextClass`** 🔴 in `ai.service.ts`, now fed by:
  - this class's questions + user's answers (scores, incorrect ones in particular),
  - top-K retrieved `contextSnippets` (personalization — GAPS 2),
  - the skill topic.
  - Store the new `Class` (next `index`), its questions, and new `contextSnippets` →
    `Vector(AI_NEXT)` — same write path as init, but this is the *learning* write.
- **Discovery UX** 🟠: after submit, show a "Generating next lesson…" state, then route to the new
  class. Minimal: poll skill status / `class.list` (should now have ≥ 2 classes).

**Decision B (open-ended answers):** MC/TF auto-score trivially from `answerKey`. Open-ended needs
either a second model call to grade or skip scoring in beta. **Default for beta:** auto-grade only
MC and TF; store `OPEN_ENDED` for self-check or a later model-grading epic.

**Definition of done W2:** user answers a 3-question quiz → the app shows generated "Lesson 2" whose
content demonstrably incorporates a mistake the user made. Integration test: assert the new class
exists, references the missed topic, and its vectors are stored.

---

## Week 3 — Make it usable by a real (non-developer) person

**Goal:** first real interactions, sensible errors, progress. [GAPS #3, #4, #8, #11]

- **Minimal auth** 🟠: replace hard-coded user 1 with a real register/login (email+password); make
  it minimal. `context.user` = actual caller. Wire `/auth` endpoints in the contract. (GAPS 3.)
  - Guard the AI-generation paths behind the real user id. The `Session` table is available — use it
    for the bearer token or defer; pick the simplest correct one.
- **Create-skill UI** 🟠: a screen/form — topic input → `rpc.skill.create` → poll status → navigate
  to the generated class. Add next-lesson navigation after submit (from W2). [GAPS 4]
- **Progress display** 🟡: show per-skill progress (classes done / % correct) using `SkillProgress`
  or a derived query. Minimal "you're here" indicator. [GAPS 8]
- **Status and progress endpoints** in the contract so the mobile app can drive these.
- **Error UX** 🟡: surface typed errors (from W1) in the UI instead of a bare spinner. [GAPS 11]
- **Mobile polish** 🟢: configurable RPC URL (remove hard-coded `10.0.2.2`), kill empty
  `ClassQuiz.tsx`, fill empty/error states. [GAPS 14]

**Definition of done W3:** two real accounts can each register/log in; log in → type a topic → read
a quiz → submit → get the next class and a progress bar.

---

## Week 4 — Harden toward beta deliverable

**Goal:** reliable, documented, deployable, tested. [GAPS 12, 13, 14, 15]

- **Test the critical paths** 🟡 (the loop is now real; lock it):
  - skill create → ACTIVE (extend W1 test),
  - quiz submit → score → next-class gen → vectors,
  - retrieval returns correct top-K,
  - auth (register → login → scoped data).
  - One integration test per path; keep them cheap and CI-able. [GAPS 12]
- **Production compose** 🟢: fix `docker-compose-prod.yaml` (note the `DATABASE_URL` → `DATABASE_HOST`
  env wiring bug); one command boots backend+db. Validate the Dockerfile's `development`/`production`
  double-build.
- **Observability** 🟢: a few structured logs around generation & retrieval (latency, model) so you
  can debug the loop in production, not just dev.
- **Cleanup.** Fix `submitAnswers` naming (it shadows the router name with a different signature);
  rename to `submitQuizAnswers`.
- **Docs.** Update ARCHITECTURE/CONCEPT/API/GAPS to match the final code.

**Definition of done W4 (== BETA):** `docker compose up` → register → learn → submit → next lesson
works for a service user; the critical-path tests pass; the docs are accurate.

---

## Explicitly out of scope (after beta)
- Real multi-tenant scaling / billing.
- `lambda` decay tuning (needs real usage data).
- OpenSearch (Qdrant is the vector store; OpenSearch was removed — see GAPS #10).
- Model-graded open-ended answers; user-generated content.
- Web admin panel / instructor tools.

## Risk register

| Risk | Why it matters | Mitigation |
|---|---|---|
| Gemini cost/slow on long loop | Each next-lesson gen is a model call | Poll status with backoff; `weak` model dev; fail → `ERROR` + retry, never hang |
| pgvector embeddings → 3072-dim blobs | large skills accumulate vectors | Limit retrieval to top-K; cap snippet creation; prune old vectors |
| Structured-prompt / JSON schema drift | Gemini schema mismatch → parse fail | Validate with fallback; typed error/retry; request `json` MIME |
| Open-ended grading | auto-grade complexity | Default: grade MC/TF only in beta |
| Repo build chain (tsup vs tsc) | `@axon/api-contract` must build first | Top-level `build`; watch-mode for dev; document boot order |

### First concrete step (do now)
1. Install deps (`pnpm install`), build `api-contract` (`pnpm --filter @axon/api-contract build`),
   and bring up `docker compose -f docker-compose-dev.yaml up -d` (Postgres + RabbitMQ + backend).
   Confirm the backend serves `/health`, `/spec.json`, and Scalar docs.
2. Migrate `apps/mobile/components/quiz/Quiz.tsx`: replace `console.log('submit')` with a real
   `rpc.quiz.submit(...)` — this proves out the contract change that Week 2 builds on.
3. In `apps/backend/src/middleware/auth.ts`, replace the hard-coded user id with an actual login
   flow (Week 3 springboard).
