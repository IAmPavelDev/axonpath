# Axon — Phases 3+4: The Adaptive Loop (execution plan)

> Written 2026-09-21 from a verified code audit. This is the **authoritative next-step plan**;
> it supersedes the Phase 3 / Phase 4 sections of `BETA_PLAN.md` as execution detail (those
> remain as original intent). The adaptive loop is the product: quiz answers + per-user lesson
> memory feed the AI to generate the next, personalized class.

## 0. Verified current state (2026-09-21)

| Area | State | Evidence |
|---|---|---|
| AI adapter | Z.ai `glm-5.3-flash`, system+user messages, JSON-schema requests | `tutoring/infrastructure/zai.client.ts` |
| Personas | `DESCRIPTION_SYSTEM`, `TUTOR_SYSTEM` wired into init | `tutoring/domain/personas.ts`, `generate-initial-skill.ts` |
| Init pipeline | description → prior-context retrieval → class 0 + questions + snippets → `AI_INITIAL` vectors | `tutoring/application/generate-initial-skill.ts` |
| Quiz submit | scored server-side vs `answerKey`, `Answer` rows persisted, unit-tested | `learning/application/commands/submit-quiz.ts(+.test.ts)` |
| Auth | Firebase email/password + Google; per-request token verification; `context.user` | `modules/identity/**`, `apps/mobile/lib/firebase.ts` |
| Retrieval | bound **only** to init, `excludeSkillId`, topK 5, degrades to `[]` | `memory/application/retrieve-relevant-context.ts` |
| Vectors | Qdrant `axon_vectors` (3072, Cosine); only `AI_INITIAL` ever written; `AI_NEXT` enum unused | `memory/infrastructure/vector.metadata.repo.ts` |
| Skill status | created `DRAFT`, **never transitions** (no `GENERATING`/`FAILED`; init success never sets `ACTIVE`) | `prisma/schema.prisma`, `skill.prisma.repo.ts` |
| Next class | does not exist — `generateNextClass` was deleted in the refactor and never re-added | — |
| Mobile | create → description poll → skill list/detail (lessons, newest first) → lesson (markdown themed) → quiz → `QuizResult`; Continue = `router.back()` | `components/{skill,class,quiz}/*` |
| Job queue | setImmediate queue, registry pattern (`skill-init` entry) | `modules/jobs/registry.ts`, `platform/infrastructure/set-immediate-jobs.ts` |

**Gap in one sentence:** a learner can read lesson 0 and submit its quiz, but nothing ever
generates lesson 1 — and the AI has no memory of what a lesson covered.

## 1. Design decisions (projection)

**D1 — Lesson summary is the memory unit; no Prisma migration for it.**
Every generated class produces a `lessonSummary` (2–4 self-contained sentences: what the lesson
covered, at what depth). It is embedded and stored as a vector: `textSnippet = summary`,
`source = AI_NEXT`, with `classId` + `classIndex` payload. Postgres already persists
`textSnippet`/`source`/`classIndex` in the `Vector` metadata row (`vector.metadata.repo.ts`
`upsert`), so relational truth is kept without touching the schema. *Rejected:* a
`Class.summary` column — nothing reads it back except retrieval, and the vector row already
carries the text.

**D2 — One retrieval call, split by source in the prompt.** `generateNextClass` calls
`retrieveContext({ userId, query: topic + " " + lastClassTitle, topK: 12 })` **without**
`excludeSkillId` (we want this skill's own history). The prompt builder splits hits:
`AI_INITIAL` → "Learner context" block, `AI_NEXT` → "Already covered — build on it, don't
repeat" block. *Rejected:* two searches (one excluded, one not) — doubles embedding/search
latency for no prompt-quality gain.

**D3 — Answers read path is a new repo method, use-case-shaped.**
`QuizRepository.findAnswersByClassAndUser(classId, userId)` returns
`AnswerReview[] = { questionId, questionText, userAnswer, correctAnswer, isCorrect }`
(joins `Question`; ordered by `id` asc). The use case keeps the **latest attempt per question**
(retakes must not flood the prompt). *Rejected:* reading raw `Answer` rows in the use case and
joining there — pushes Prisma shape knowledge out of the adapter.

**D4 — Highest class index via a targeted repo method.**
`ClassRepository.findTopBySkill(skillId)` → `{ id, index, title } | null` (Prisma
`orderBy: { index: "desc" }, take: 1`). *Rejected:* reusing `listBySkill` — it requires
`userId`, returns full rows, and the semantic is "latest lesson", not "list".

**D5 — Status lifecycle closes the DRAFT-forever bug.** Prisma migration adds `GENERATING` and
`FAILED` to `SkillStatus`. Flow: `create-skill` → `GENERATING`; init success → `ACTIVE`; init
failure → `FAILED` + `ERROR_OCCURRED` event. Next-class generation keeps the skill `ACTIVE`
(clients detect progress via `class.list`). Backfill in the same migration: `DRAFT` skills with
≥1 class → `ACTIVE`; `DRAFT` with 0 classes → `FAILED` (retry UX is Phase 6). PG ≥12 allows
`ALTER TYPE ... ADD VALUE` inside the migration transaction as long as the new values aren't
used in it — they aren't (backfill writes existing values).
`SkillRepository.update` patch gains `status`. Mobile: `SkillList.isPreparing` becomes
`status === "GENERATING"`; old `DRAFT` rows cease to exist after backfill.

**D6 — Trigger: the submit-quiz use case enqueues the job.** After a successful persist with
≥1 scored answer, `submit-quiz` enqueues `skill-next-class` with `{ skillId, userId }`
(`skillId` comes from `ScoreableQuestion.skillId`). *Rejected:* a separate "generate next"
RPC — an extra client round-trip and a second place to forget dedup; the submit *is* the
learning signal. No dedup guard in beta: a retake regenerates a variant; acceptable until
Phase 6.

**D7 — Generation schema for the next class** = init schema (`MULTIPLE_CHOICE`/`TRUE_FALSE`
only, `answerKey`, choices) **plus** `lessonSummary`, **plus** `contextSnippets` (3–5 learner
facts — keeps the memory compounding; written as `AI_INITIAL` at the new `classIndex`, matching
the source's "fact about the learner" semantics). The prompt carries: skill topic, last class
title + its summary (from the vector hit or passed through), the mistake list (question text,
user answer, correct answer) or an explicit "all correct — raise difficulty/depth", and the D2
history blocks. Parsing reuses the defensive `extractJsonObject` + `toGeneratedQuestion`
normalize step — `glm-5.3-flash` drifts, exactly as in init.

**D8 — Contract: minimal.** `GetClassByIdOutput` gains `skillId: number` — the mobile class
screen needs it to poll `class.list` after submit (today it only has `classId`). No new routes:
trigger = `quiz.submit`, observation = `class.list` poll.

**D9 — Mobile loop UX.** After the quiz result's **Continue**: the class screen switches to a
"Generating your next lesson…" state — `PulseDot` + copy; polls `class.list({ skillId })` every
2.5 s against the id set captured at entry; when a new class id appears →
`router.replace("/class/" + newId)` (the loop continues seamlessly). Timeout ~90 s → "Still
generating — check back soon" + button to the skill page. *Rejected:* navigating back to
`skill/[skillId]` and polling there — breaks immersion for zero extra robustness.

## 2. Implementation (ordered)

### Step 1 — Contract (`packages/api-contract`)
- `schema/class.schema.ts`: `GetClassByIdOutput` += `skillId: z.number()`.
- Build: `pnpm --filter @axon/api-contract build` (backend resolves the workspace build).

### Step 2 — Repositories (`apps/backend/src/modules/learning`)
- `domain/class/class.repository.ts` + `infrastructure/class.prisma.repo.ts`: add
  `findTopBySkill(skillId)` → `{ id, index, title } | null`.
- `domain/quiz/quiz.repository.ts` + `infrastructure/quiz.prisma.repo.ts`: add
  `findAnswersByClassAndUser(classId, userId)` → `AnswerReview[]` (join Question for
  `text` + `answerKey`, order by `id` asc).
- `domain/skill/skill.repository.ts` + `infrastructure/skill.prisma.repo.ts`: `update` patch
  accepts `status?: string`.

### Step 3 — Migration + status flips
- New Prisma migration: add `GENERATING`, `FAILED` to `SkillStatus`; backfill per D5.
- `learning/application/commands/create-skill.ts`: create with `status: GENERATING`
  (repo `create` change).
- `tutoring/application/generate-initial-skill.ts`: on success → `skillRepo.update(id,
  { status: "ACTIVE" })`; on failure → `{ status: "FAILED" }` + `ERROR_OCCURRED` event (job
  handler already logs; the event makes it queryable). Failure covers both `AiGenerationFailed`
  and `AiResponseInvalid` returns and vector errors.
- `mobile/components/skill/SkillList.tsx`: `isPreparing = status === "GENERATING"`.

### Step 4 — Prompts (`tutoring/domain/prompts.ts`)
- `INIT_SKILL_SCHEMA` += `lessonSummary` (required string); `buildInitSkillPrompt` asks for it
  ("2-4 self-contained sentences describing what this lesson covered and at what depth").
- New `NEXT_CLASS_SCHEMA` (init shape + `lessonSummary`) and `buildNextClassPrompt({ topic,
  lastTitle, lastSummary, history, mistakes })` rendering the D2/D7 blocks. Personas: reuse
  `TUTOR_SYSTEM` (next-class is the same tutor job).

### Step 5 — Init writes its summary vector
- `generate-initial-skill.ts`: after class persist, embed `parsed.lessonSummary` →
  `recordVectors` with `source: AI_NEXT`, `classIndex: 0` (snippets stay `AI_INITIAL`). Embed
  summary + snippets in one `generateEmbeddings` call where practical.

### Step 6 — `generate-next-class.ts` (new use case)
`modules/tutoring/application/generate-next-class.ts`, curried deps
`{ ai, retrieveContext, skillRepo, classRepo, quizRepo, eventRepo, recordVectors, chatModel }`,
input `{ skillId, userId }`, `Result<void, GenerateNextClassError>`:
1. `skillRepo.findById` → null ⇒ error `SkillNotFound`.
2. `classRepo.findTopBySkill` ⇒ null ⇒ error `NoClassesYet` (init didn't finish — job must not
   run; treat as permanent, don't retry).
3. `quizRepo.findAnswersByClassAndUser(last.id, userId)` → reduce to latest attempt per
   question; split `mistakes` / `allCorrect`.
4. `retrieveContext({ userId, query: `${skill.topic} ${last.title}`, topK: 12 })` (degrades to
   `[]`; map hits to `{ textSnippet, source }` for the prompt builder).
5. `ai.generateJson({ system: TUTOR_SYSTEM, prompt }, { schemaName: "next_class",
   responseSchema: NEXT_CLASS_SCHEMA })`; defensive parse exactly like init (same helpers —
   extract them to `tutoring/domain/parse.ts` if importing from the init file is awkward).
6. `eventRepo.record(CLASS_GENERATED, { action: "next_class", prompt, system, model, response })`
   (audit parity with init).
7. `classRepo.create({ index: last.index + 1, ... })` → `quizRepo.createQuestions(...)` →
   embed `lessonSummary` (+ `contextSnippets`) → `recordVectors` (`AI_NEXT` summary,
   `AI_INITIAL` snippets, `classIndex: last.index + 1`).
8. Return `ok`. Vector failures return `VectorUpsertFailed`/`VectorStoreUnavailable` like init.

### Step 7 — Job + trigger
- `modules/jobs/registry.ts`: `SKILL_NEXT_CLASS_JOB = "skill-next-class"` (export from
  `generate-next-class.ts`, mirroring `SKILL_INIT_JOB`), payload `{ skillId, userId }`, registry
  entry + `getGenerateNextClassJobHandler` (copy the init handler's log/failure shape).
- `submit-quiz.ts`: deps += `jobs: JobQueuePort`; after `createAnswers`, if
  `scored.length > 0`, enqueue with `skillId` from the first scored question's `question.skillId`.
- `container.ts`: build `generateNextClass`, pass to `makeJobHandlers`, pass `jobs` through to
  quiz handler deps (`router/index.ts` `QuizApiDeps` chain gains `jobs`).

### Step 8 — Mobile: the loop
- `types/class.ts`: add `skillId` to `ClassById`.
- `app/class/[classId]/index.tsx`: `QuizView` receives `skillId`; owns phase state
  `quiz → result → generating`. `Quiz`'s internal `onContinue={() => router.back()}` becomes a
  parent-provided callback (Quiz.tsx already renders `QuizResult` with `onContinue`).
- Generating state: `PulseDot` + copy, `useQuery(class.list, refetchInterval: 2500)`; baseline
  ids captured when the phase starts (one fetch before polling); new id ⇒
  `router.replace(`/class/${id}`)`; 90 s timeout ⇒ fallback text + link to
  `/skill/${skillId}`.
- Light/dark variants via existing `THEME` helpers; no new colors (monochrome system).

## 3. Testing

### Unit (vitest, conventions of `submit-quiz.test.ts`)
- `generate-next-class.test.ts` (new):
  - happy path: fake repos → asserts class created at `index + 1`, questions written,
    `AI_NEXT` vector recorded with `classIndex = last.index + 1`, snippets as `AI_INITIAL`,
    `CLASS_GENERATED` event with prompt+response payload;
  - mistake emphasis: prompt (captured via fake `ai.generateJson`) contains the wrong
    question text and the correct answer;
  - `allCorrect` path: prompt contains the raise-difficulty instruction, no mistake block;
  - latest attempt wins: two answers for one question ⇒ only the newer in the prompt;
  - `NoClassesYet` and `SkillNotFound` errors; retrieval failure ⇒ generation still proceeds
    (empty history blocks); AI parse failure ⇒ `AiResponseInvalid`, nothing persisted.
- `submit-quiz.test.ts`: new case — successful submit enqueues `skill-next-class` once with
  `{ skillId, userId }`; zero valid answers ⇒ no enqueue.
- `create-skill` / init tests: status transitions (`GENERATING` on create; `ACTIVE` on success;
  `FAILED` + `ERROR_OCCURRED` on generation failure).

### Integration smoke (running stack)
1. `docker compose -f docker-compose-dev.yaml up -d`; backend serves `/health`.
2. Register/login (Firebase) → `skill.create` → poll `skill.get` until `ACTIVE` (not DRAFT).
3. Read class 0, submit quiz with **one deliberate wrong answer**.
4. Poll `class.list` → count 2.
5. `psql`: `SELECT "source", "classIndex" FROM "Vector" WHERE "skillId" = <id>` → rows
   `AI_INITIAL` and `AI_NEXT` present; `Event` row `CLASS_GENERATED` payload's prompt contains
   the missed question text and an `AI_NEXT` snippet.
6. New lesson content demonstrably builds on the mistake (read `class.get` content).
7. Retake the quiz → third class generated (D6 no-dedup behavior confirmed, not crashed).

### Mobile (emulator, light + dark)
- Typecheck/build: `pnpm --filter axon-mobile exec tsc --noEmit` (or project's check script).
- Visual: submit → result → Continue → generating state renders (pulse, copy); auto-navigate
  into lesson 1; timeout path shows fallback (test by pointing at a paused backend).
- `SkillList`: in-flight skill shows "preparing" (`GENERATING`), finished shows normal.

### Acceptance (beta proof — from BETA_PLAN P4, unchanged)
Deliberate mistake in quiz ⇒ a second class appears addressing the miss; `Answer`,
`CLASS_GENERATED` event, and `AI_NEXT` vector all persisted; skills reach `ACTIVE`/`FAILED`
instead of living in `DRAFT`.

## 4. Explicitly deferred (Phase 6 / post-beta)
- `FAILED` badge + retry button (re-enqueue `skill-init` / `skill-next-class`), init
  idempotency guard.
- Retake dedup (skip generation if an unanswered next class already exists).
- `EXPO_PUBLIC_API_URL` wiring in `utils/rpc.ts`; AI grading for open-ended; `ANSWER_DERIVED`
  vectors; `SkillProgress` write path; ARCHITECTURE/GAPS rewrite.
