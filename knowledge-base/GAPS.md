# Axon — Gap Analysis (current → beta)

> Every gap between "today" and "workable beta". Each item is verifiable: an acceptance criterion
> is given. Priority = how much it blocks the product's core idea. See ROADMAP.md for the
> sequenced plan.

## Legend
- 🔴 **Blocker** — the core adaptive loop cannot function without it.
- 🟠 **High** — the product is unusable/unsafe for real users without it.
- 🟡 **Medium** — needed for beta polish/production-readiness.
- 🟢 **Low** — nice-to-have / hardening.

---

## 🔴 B1. The adaptive loop is not implemented
- **Evidence:** `ai.service.ts` has `generateNextClass` **commented out**. `quiz.submit` is not
  routed. Answers are never recorded. Vectors are never retrieved.
- **Impact:** The product's entire point ("AI builds the next lesson from what you got wrong") does
  not exist. What works today is a static single-lesson renderer.
- **Acceptance (beta):** answering a quiz produces a new, adapted lesson that references the user's
  mistakes, end-to-end.

## 🟢 B2. Vector memory — write + retrieve (mostly closed)
- **Evidence:** Vectors are now stored in **Qdrant** (`qdrant/qdrant:v1.19.1`, collection
  `axon_vectors`); `vector.service.ts` provides `createVectors` (upsert) and `searchSimilar`.
  The `embedding vector(3072)` column and `vector` extension were dropped from Postgres (migration
  `20260905120000_qdrant_vectors`); `Vector` retains relational metadata only.
- **Status:** `searchSimilar` is wired into `generateInitSkill` — a new skill retrieves the user's
  prior context (filtered by `userId`, excluding the new skill) and feeds it to Gemini.
- **Remaining:** retrieval is not yet bound to per-class `generateNextClass` (still commented out) nor
  to `ANSWER_DERIVED` vectors.

## 🟠 3. No real authentication
- **Evidence:** `middleware/auth.ts` upserts hard-coded user id 1 and ignores the client's Bearer
  token. `User.password` never validated; `Session` table unused.
- **Impact:** can't have real users, per-user data is meaningless, unsafe.
- **Acceptance (beta):** at minimum a single real credential (email+password) or a lightweight
  token flow; `context.user` reflects the actual caller. Heavy multi-user infra is out of scope.

## 🟠 4. Create-skill has no UI path
- **Evidence:** mobile has no screen/button calling `rpc.skill.create`.
- **Impact:** a user cannot start a learning journey from the app.
- **Acceptance (beta):** user can type a topic, tap go, and be taken to the generated lesson.

## 🟠 5. Quiz submit is dead
- **Evidence:** mobile `Quiz.tsx` Submit button does `console.log('submit')`. `quiz.submit` un-wired.
  A handler already exists as dead code (`controllers/quiz.controller.ts:22`, `submitQuizHandler`)
  — only the contract export + router wiring are missing.
- **Impact:** quiz is cosmetic; no data, no scoring, no adaptation trigger.
- **Acceptance (beta):** submitting records answers, scores them, and (per 🔴1) triggers next-class
  generation.

## 🟠 6. Fire-and-forget AI gen is unobservable
- **Evidence:** `runDetached` (`setImmediate`) runs the whole Gemini init pipeline in the background
  with only `console.error` on failure. Client gets id+`DRAFT` immediately; errors are invisible.
- **Impact:** the user can't tell if a skill is generating, failed, or done; stuck skills stay DRAFT.
- **Acceptance (beta):** a status/progress channel: `PENDING → GENERATING → ACTIVE | ERROR`, visible
  in the UI, with retry on error.

## 🟡 7. Skill status is never advanced
- **Evidence:** `SkillStatus` enum has 5 states; everything stays `DRAFT`. No transitions anywhere.
- **Impact:** no lifecycle, `COMPLETED`/`PAUSED` unreachable, progress undefined.
- **Acceptance (beta):** a skill visibly moves DRAFT→ACTIVE (after gen) and later→COMPLETED.

## 🟡 8. No progress tracking
- **Evidence:** `SkillProgress` table exists, `Event` audit partially used; no aggregation, no
  progress endpoint, no dashboard.
- **Acceptance (beta):** "x/y classes done, n% score" visible per skill.

## 🟡 9. Answer schema/flow incomplete
- **Evidence:** `quiz.service.submitAnswers` re-fetches questions but never persists `Answer` rows
  or scores them; `Question.answerKey` is dropped from the quiz.get output so there's nothing to
  grade against. `Answer` has `skillId` nullable; answer→vector derivation unimplemented.
- **Acceptance (beta):** answers persisted with score + correctness; `ANSWER_DERIVED` vectors
  extracted for retrievable memory.

## 🟡 10. Hard-coded / dead config (partially closed)
- **Evidence:** `queue.service.ts` literal `amqp://user:password@localhost`; RabbitMQ container
  declared but no queue consumer/producer.
- **Status:** Dead OpenSearch/aws config and deps (`@aws-sdk/client-opensearchserverless`,
  `@opensearch-project/opensearch`) and the `vectorDb.endpoint` placeholder were removed during the
  Qdrant migration.
- **Acceptance (beta):** RabbitMQ either works (used for gen jobs) or is removed; queue URL from env.

## 🟡 11. Errors are not surfaced to the client
- **Evidence:** controller throws plain `new Error("Class not found")`; `runDetached` swallows
  failures; no typed error mapping; mobile only shows a generic error from react-query.
- **Acceptance (beta):** structured error responses (code + message) surfaced in the UI.

## 🟡 12. No tests
- **Evidence:** both `apps/backend` and root `package.json` test scripts are stubs
  (`echo "Error: no test specified"`). Zero tests.
- **Acceptance (beta):** at least one integration test per critical path: create-skill pipeline,
  quiz submit+score, vector retrieval, auth.

## 🟢 13. Non-transactional background pipeline
- **Evidence:** skill-init does many writes sequentially with no transaction; a mid-failure leaves
  orphan classes/questions/vectors and a DRAFT skill.
- **Acceptance (beta):** the background pipeline is transactional or safely retryable/idempotent.

## 🟢 14. Mobile polish & config
- **Evidence:** RPC URL hard-coded to `10.0.2.2:3001`; `ClassQuiz.tsx` empty stub; Markdown renderer
  un-styled beyond basic; no loading/empty/error states; quiz store has no submit wiring.
- **Acceptance (beta):** RPC URL configurable (env); no empty stubs; graceful empty/error states;
  submit wired to real API.

## 🟢 15. Build/dev reproducibility
- **Evidence:** no monorepo root dev script (root `backend:dev` = compose); mobile + backend start
  are two manual steps; `packages/api-contract/dist` is required but must be built before backend
  resolves `@axon/api-contract`. No `.env.example` exists — the gitignored root `.env` is the only
  env documentation outside knowledge-base/ARCHITECTURE.md §7.
  The backend `dev-db`/`dev-db:stop` scripts reference `apps/backend/dev-db/docker-compose.yaml`,
  which does not exist (broken scripts).
- **Acceptance (beta):** a single documented `pnpm dev` (or compose) boots the full stack
  deterministically.

---

## Summary feasibility

The **critical core is small and well-scoped**: close items 🔴1, 🔴2, 🟠5, 🟠6, 🟡7 and you have a
single-author adaptive loop that can demo. 🟠3 (auth) and 🟠4 (create UI) make it usable by someone
other than the developer. The rest is hardening. A focused 3–4 week push can realistically land
🔴1, 🔴2, 🟠3(light), 🟠4, 🟠5, 🟡6–9, 12 — i.e. a genuinely working beta — see ROADMAP.md.