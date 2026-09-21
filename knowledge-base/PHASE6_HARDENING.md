# Axon — Phase 6: Beta Hardening (execution plan)

> Written 2026-09-21 from a verified code audit. Executed and **DONE 2026-09-21** — all steps
> S1–S8 landed with evidence below in §2/§3. Beta acceptance (§4) passes: failed generation is
> visible + recoverable, the loop scenario is a committed CI-able test, consecutive retakes
> no longer flood variants, `EXPO_PUBLIC_API_URL` overrides the RPC base, the prod image boots
> `/health` with migrations, and docs match the code (12 test files / 64 tests green; mobile
> `tsc --noEmit` clean).

## 0. Verified current state (2026-09-21)

Phase 3+4 landed and was code-verified: adaptive loop works end-to-end, `GENERATING → ACTIVE |
FAILED` lifecycle live, 50/50 backend unit tests green, docs synced (BETA_PLAN, ARCHITECTURE,
GAPS). What remains, with evidence:

| # | Gap | Evidence |
|---|---|---|
| 1 | `FAILED` invisible on mobile; no retry path | zero `FAILED` hits in `apps/mobile/**`; `skill.contract.ts` exports only `create/edit/get/list`. State machine already allows `FAILED → GENERATING` (`learning/domain/skill/skill.ts`) and status ships in `GetSkillListOutput`/`GetSkillByIdOutput` — only the route + UI are missing |
| 2 | Init is not retry-safe | `generate-initial-skill.ts` unconditionally `classRepo.create({ index: 0, ... })`; re-running `skill-init` on a skill that already has class 0 violates `UNIQUE(skillId, index)` → job logs, skill stuck `GENERATING` |
| 3 | Retake dedup missing | `submit-quiz.ts` enqueues `skill-next-class` on **every** scored submit; D6 accepted a variant per retake "until Phase 6" |
| 4 | No composed integration test | 10 test files are per-unit with fake ports; nothing exercises create → init → submit → next-class as one flow |
| 5 | `EXPO_PUBLIC_API_URL` unwired | `utils/rpc.ts` hard-codes `localhost` / `10.0.2.2` per `Platform.select` |
| 6 | Prod deploy broken | `Dockerfile` stages = `base`/`build`/`development` only (no `production`); `docker-compose-prod.yaml:16` `DATABASE_URL=${DATABASE_HOST}` wiring bug |
| 7 | `SkillRepository.findById` lacks `userId` | returns `{ id, topic, description, status }` (`skill.repository.ts`) — retry needs an ownership check |
| 8 | `Question.classId` is optional | Prisma default `onDelete: SetNull` for the optional relation — deleting a class would orphan questions; this rules out "replace" retry semantics (see D2) |

## 1. Design decisions

**D1 — Retry = a `skill.retry` command that re-enters `GENERATING`; ownership-checked.**
Contract: `retry` route `POST /skill/:id/retry`, input = existing `SkillIdInput`, output = existing
`StatusOnly` (no new schemas). Command `learning/application/commands/retry-skill.ts`, deps
`{ skillRepo, jobs }` (same shape as `CreateSkillDeps`, so `SkillApiDeps` needs no new members):
load skill via `findById` (extended to return `userId`, D7) → not found ⇒ `SkillNotFound`
(404, existing mapping); `skill.userId !== context.user.id` ⇒ `NotOwned` (404 — do not leak
existence); `skill.status !== "FAILED"` ⇒ `InvalidTransition` (409, checked via the existing
`canTransition`); else update status → `GENERATING` and enqueue `SKILL_INIT_JOB
{ skillId, userId, topic }` (payload identical to create). `toORPCError` gains `NotOwned → 404`,
`InvalidTransition → 409`. Mobile calls it from the skill list and detail on `FAILED` rows.

**D2 — Init retry-safety = skip-if-any-class-exists, not replace.** First line of the init
attempt: `const top = await classRepo.findTopBySkill(input.skillId)` (method exists since
Phase 3+4); if `top !== null` skip generation entirely and return `ok` — the wrapper then flips
`GENERATING → ACTIVE`, healing both failure shapes:
- failed *before* persist (no classes): full regeneration runs;
- failed *after* a partial persist (class 0 exists, vectors missing): retry heals status to
  `ACTIVE`; the loop works and retrieval degrades to `[]` for the missing summary (existing
  policy). Accepted cost for beta.
*Rejected:* replace semantics — `Question.classId` is optional ⇒ Prisma `onDelete: SetNull`
orphans questions on class delete; doing it properly needs a cascade audit + transaction. Skip
is boring and cannot corrupt an `ACTIVE` skill.

**D3 — Retake dedup: skip generation when an unanswered next class already exists.** New repo
method `QuizRepository.findHighestAnsweredClassIndex(skillId, userId): Promise<number | null>`
(join `Answer → Question → Class`, max `Class.index`; adapter decides the Prisma shape). In
`generate-next-class`, right after `findTopBySkill`: skip (return `ok`, no event) iff
`last.index > (answeredIndex ?? -1)` — i.e. the newest class already exists and the user has
never answered anything past their last answered class. Semantics:
- first submit of class *k*: `answeredIndex = k`, `last.index = k` → generate *k+1* ✅
- consecutive retake of class *k* while *k+1* exists unanswered: `answeredIndex = k`,
  `last.index = k+1` → skip ✅ (the D6 flood is gone)
- retake of an *old* class after answering a newer one: regenerates from the latest class —
  accepted (submit is still a learning signal; content builds on `findTopBySkill`).
The decision lives in the use case, not in `submit-quiz` (which keeps enqueueing every scored
submit): the use case is the single decision point and cannot race the client.
*Behavior change vs Phase 3+4 acceptance step 7* (retake → third class): first retake still
generates; a second consecutive retake no-ops.

**D4 — Integration test = composed unit test, deterministic, CI-able.** New
`apps/backend/src/modules/loop.integration.test.ts`: wire the **real** use cases
(`makeCreateSkill`, `makeGenerateInitialSkill`, `makeSubmitQuiz`, `makeGenerateNextClass`,
`makeRetrySkill`) with in-memory fakes — scripted `AiPort` (`generateJson` keyed by
`schemaName`: description → init → next_class; deterministic `generateEmbeddings`), Map-backed
repos, a capturing `JobQueuePort` (enqueues recorded; handlers invoked explicitly — no
`setImmediate` timing). Reuse fakes from `generate-initial-skill.test.ts` /
`generate-next-class.test.ts`; if that duplicates a lot, extract to
`src/modules/testing/fakes.ts` (one extraction, no framework). Asserts the full §3 scenario
including the `FAILED` → retry → `ACTIVE` heal and the D3 dedup skip. *Rejected:* HTTP/E2E
against a running stack — slow, flaky in CI, duplicates the manual smoke.

**D5 — `EXPO_PUBLIC_API_URL` wiring.** `utils/rpc.ts`: `const base = process.env.EXPO_PUBLIC_API_URL`
falling back to the current `Platform.select` values. Two-line change; document in
`.env.example`-adjacent mobile README if one exists, else the var name is self-documenting.

**D6 — Prod image + compose.** Add a `production` stage to `Dockerfile` (`FROM base AS
production`: production deps + build-stage `dist` + `src/prisma` migrations; CMD runs
`prisma migrate deploy && node dist/main.js` — mirror whatever the `build` stage actually
produces, read it first). Fix `docker-compose-prod.yaml:16` to pass `DATABASE_URL` through
(`DATABASE_URL: ${DATABASE_URL:?DATABASE_URL required}`) and drop/replace the `DATABASE_HOST`
remnant. Acceptance: `docker compose -f docker-compose-prod.yaml build` succeeds and the
container boots `/health` against the dev Postgres/Qdrant.

**D7 — Small repo enablers.** `SkillRepository.findById` select gains `userId` (port +
`skill.prisma.repo.ts`). Nothing else — deliberately no new architecture.

## 2. Implementation (ordered; S1 before S2, everything else parallelizable)

### S1 — Init retry guard (D2) — ✅ DONE
- `generate-initial-skill.ts`: `findTopBySkill` short-circuit at attempt start.
- `generate-initial-skill.test.ts`: new cases — retry after pre-persist failure regenerates;
  retry when class 0 exists skips generation (fake `ai` called only for description, or not at
  all) and still flips status `ACTIVE`.

### S2 — `skill.retry` backend (D1, D7) — ✅ DONE
- `skill.repository.ts` + `skill.prisma.repo.ts`: `findById` += `userId`.
- New `retry-skill.ts` command + `retry-skill.test.ts` (happy path re-enqueues `skill-init`
  with the create payload; NotOwned; InvalidTransition on `ACTIVE`/`GENERATING`; SkillNotFound).
- `packages/api-contract`: `retry` contract entry (`SkillIdInput` → `StatusOnly`); rebuilt.
- `skill.handlers.ts` `retry` handler; `error-mapping.ts`: `NotOwned` → 404,
  `InvalidTransition` → 409; router wiring (deps already existed in `SkillApiDeps`).

### S3 — Retake dedup (D3) — ✅ DONE
- `quiz.repository.ts` + `quiz.prisma.repo.ts`: `findHighestAnsweredClassIndex`.
- `generate-next-class.ts`: skip branch (returns `ok`, records nothing).
- `generate-next-class.test.ts`: new cases — dedup skip (no AI call, no class, no event),
  fresh submit still generates, `answeredIndex = null` generates (safe default; no evidence
  the learner is behind).

### S4 — Mobile `FAILED` surfacing + retry (D1) — ✅ DONE
- `SkillList.tsx`: `FAILED` row → "Failed to prepare" chip + retry affordance
  (`useMutation(rpc.skill.retry)` → invalidate the skills query → row flips to the existing
  `GENERATING` preparing state).
- `SkillDetail.tsx`: when `status === 'FAILED'` show error copy + retry button (same mutation).
- Emulator visual check deferred to the next dev session (chip/banner use existing tokens).

### S5 — `EXPO_PUBLIC_API_URL` (D5) — ✅ DONE
- `utils/rpc.ts` env override with the previous platform fallbacks.

### S6 — Loop integration test (D4) — ✅ DONE
- `src/modules/loop.integration.test.ts` + `src/modules/testing/fakes.ts` (the one sanctioned
  extraction): asserts the full §3 scenario incl. the FAILED → retry → ACTIVE heal in both
  failure shapes and the D3 dedup skip.

### S7 — Prod image + compose (D6) — ✅ DONE
- Backend now emits `dist/` (tsc, `module: nodenext` → CJS + `module-alias`; tsconfig noEmit
  removed; build script copies the generated Prisma client).
- Dockerfile: real `build` steps + `production` stage (prod-only deps + dist + prisma dir;
  CMD runs `prisma migrate deploy` then `node -r module-alias/register dist/src/main.js`).
- `docker-compose-prod.yaml` rewritten: no host-volume shadowing, `DATABASE_URL: ?required`
  passthrough (the `DATABASE_HOST` remnant is gone), shared `axon-network` with the dev stack.
- Verified: `docker compose build` succeeds; container boots `/health` (200) against the dev
  Postgres/Qdrant; migrate deploy reports "No pending migrations"; `POST /rpc/skill/retry`
  routes (401 without bearer).

### S8 — Docs final pass (after S1–S7 land) — ✅ DONE
- ARCHITECTURE.md: `skill.retry` in the RPC table, dedup + retry guard in §4.2, mobile/test
  sections updated, §9 cleared to the post-beta backlog. GAPS.md: 11/12/14/15 closed, 13
  partial (transactionality). BETA_PLAN: Phase 6 DONE. This file: steps checked off.

## 3. Testing

### The scenario (S6 asserts it; S8 verifies it live too)
1. `create` → skill `GENERATING`; run `skill-init` handler → `ACTIVE`, class 0, questions,
   `AI_NEXT` summary vector + `AI_INITIAL` snippet vectors at `classIndex 0`.
2. `quiz.submit` with one deliberate wrong answer → `Answer` rows scored; `skill-next-class`
   enqueued with `{ skillId, userId }`.
3. Run the next-class handler → class at `index 1`; captured prompt contains the missed question
   text + its correct answer + an `AI_NEXT` history snippet; `CLASS_GENERATED` event recorded;
   status still `ACTIVE`.
4. Submit the **same** quiz again (retake) → handler runs → **no** class 2, no event (D3).
5. Force init failure (scripted `AiGenerationFailed`) on a fresh skill → `FAILED` +
   `ERROR_OCCURRED` event; `skill.retry` → `GENERATING` → handler → `ACTIVE`.

### Unit tests added per step
S1: two guard cases. S2: four command cases. S3: three dedup cases. All follow existing
`*.test.ts` conventions (curried use cases, fake ports, `Result` assertions).

### Manual / emulator
- Failure demo: point `ZAI_API_KEY` at garbage → create skill → `FAILED` chip appears in list →
  restore key → retry → preparing state → `ACTIVE` with lesson 0. (This is the hardening demo.)
- Loop still works: deliberate mistake → result → generating → auto-navigate into lesson 2 that
  addresses the miss; double-submit does not produce lesson 4 (dedup visible).
- `pnpm --filter axon-mobile exec tsc --noEmit`; `pnpm --filter @axon/backend test`; prod build +
  boot (S7).

## 4. Acceptance (beta is done when)
1. A failed generation is **visible** (FAILED chip) and **recoverable** (retry → ACTIVE) from the
   app, and a retry can never corrupt an existing skill (S1 guard + D2).
2. The loop scenario (§3) passes as a committed CI-able test.
3. Consecutive retakes no longer flood the skill with variant lessons (D3).
4. `EXPO_PUBLIC_API_URL` overrides the mobile RPC base URL.
5. `docker compose -f docker-compose-prod.yaml build` produces an image that boots and serves
   `/health` with migrations applied.
6. Docs match the code (S8); full backend suite + mobile typecheck green.

## 5. Explicitly deferred (post-beta backlog — unchanged)
Progress UI/aggregation (`SkillProgress`), `ANSWER_DERIVED` vectors mined from answers, AI
grading for open-ended questions, `lambda` decay tuning, durable jobs (RabbitMQ behind
`JobQueuePort`), `PAUSED`/`COMPLETED` lifecycle UX, transactional init pipeline, RabbitMQ
container removal from dev compose (or its adoption).
