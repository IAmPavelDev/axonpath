# Axon — API Surface (contract-first, oRPC)

> Source of truth: **`packages/api-contract`** (contracts + Zod schemas) and the backend routers
> that implement them. This doc mirrors the actual code. Anything marked **[UNWIRED]** exists in a
> schema/contract but is not reachable end-to-end.

## 1. Transport

- All RPC calls go through **POST** to the oRPC handler at prefix **`/rpc`**.
- Single server factory also serves **`/spec.json`** (OpenAPI 3, generated) and **`/`** (Scalar
  docs UI for that spec).
- Fastify-native routes: `GET /health`, `GET /ready`, `GET /info`.
- Client is a **typed oRPC client** (`createORPCClient` + `RPCLink`); the mobile app imports the
  shared `AppContract` type so calls are compile-checked.

> The OpenAPI spec exposes declared `method`+`path` per route (e.g. `GET /skill/list`), but the
> wire protocol the client actually uses is the oRPC RPC format on `/rpc`. Both are generated from
> the same contract.

## 2. Router tree

```
router
├── skill
│   ├── create
│   └── list
├── class
│   ├── list
│   └── get
└── quiz
    ├── get
    └── submit   ← [UNWIRED] contract declares submit, no router/handler
```

## 3. Skill

### `skill.create` → POST `/skill/create`
Input (`CreateSkillInput`):
```ts
{ topic: string }
```
Output (`CreateSkillOutput`):
```ts
{ id: number, status: string }   // status = "DRAFT"
```
Behavior: creates a `Skill` (DRAFT), then **detached** (`setImmediate`) background job runs Gemini:
create Class index 0 → create Questions → embed contextSnippets → insert Vectors. Client returns
immediately with id + status. **No progress/error channel.**

### `skill.list` → GET `/skill/list`
Output (`GetSkillListOutput`):
```ts
Array<{ id: number, topic: string, status: string, createdAt: Date }>
```
Behavior: returns current user's skills.

## 4. Class

### `class.list` → GET `/class/list`
Input (`GetClassListInput`):
```ts
{ skillId: number }
```
Output (`GetClassListOutput`):
```ts
Array<{ id: number, title: string }>
```
> Only `{id, title}` — not `contentMd`. Use `class.get` for content.

### `class.get` → GET `/class/:id`
Input (`GetClassByIdInput`):
```ts
{ id: number }
```
Output (`GetClassByIdOutput`):
```ts
{ id: number, title: string, contentMd: string }
```
Behavior: throws `"Class not found"` if missing.

## 5. Quiz

### `quiz.get` → GET `/quiz/:id`
Input (`GetQuizByClassIdInput`):
```ts
{ classId: number }
```
Output (`GetQuizByClassIdOutput`):
```ts
Array<{
  id: number
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "OPEN_ENDED"
  text: string
  choices: string[]        // note: choices is REQUIRED non-nullable in schema
}>
```
> The output schema drops `answerKey` (never sent to client — good for cheating avoidance).

### `quiz.submit` → POST `/quiz/:id/submit` — **[UNWIRED]**
Contract:
```ts
Input:  { answers: Array<{ questionId: number, answer: string }> }
Output: Array<Question>   // same shape as quiz.get
```
**Reality:** `quiz.contract.ts` declares `submit`, but the exported `quizContract` omits it — so
`rpc.quiz.submit` is unreachable — and `router/quiz.router.ts` only wires `get`.
A controller for it **already exists** as dead code (`controllers/quiz.controller.ts:22`,
`submitQuizHandler` → `QuizService.submitAnswers`) — it is never wired by the router.
`QuizService.submitAnswers` itself only re-fetches questions — it does **not** record answers,
score them, or derive vectors. **Nothing calls it. The mobile Submit button does nothing.**

## 6. Auth context

Every handler receives `context.user` injected by `authMiddleware`. Today that is always the
hard-coded user **id 1** (John Doe, ADMIN). There is **no real authentication** — password is never
checked, the client's `Bearer token` is ignored. See ARCHITECTURE §4.5 and ROADMAP.

## 7. Schema vs. service coverage (implemented surface by file)

| Contract op | contract exists | service fn | router wired | controller | reachable |
|---|---|---|---|---|---|
| skill.create | ✅ | `SkillService.createSkill` | ✅ | ✅ | ✅ |
| skill.list | ✅ | `SkillService.getSkillsList` | ✅ | ✅ | ✅ |
| class.list | ✅ | `ClassService.getClassesList` | ✅ | ✅ | ✅ |
| class.get | ✅ | `ClassService.getClassById` | ✅ | ✅ | ✅ |
| quiz.get | ✅ | `QuizService.getQuestionsByClassId` | ✅ | ✅ | ✅ |
| quiz.submit | ⚠️ | `QuizService.submitAnswers` (stub) | ❌ | ⚠️ handler exists, unwired | ❌ |
> `quiz.submit` is declared in `quiz.contract.ts` but omitted from the exported `quizContract`, so
> the typed client (`AppContract`) has no `quiz.submit` to call either.

## 8. Out-of-band endpoints (Fastify, not RPC)

- `GET /health` — status, uptime, env, version.
- `GET /ready` — simple alive probe.
- `GET /info` — service metadata + endpoint list.
- `GET /` — Scalar API docs HTML.
- `GET /spec.json` — OpenAPI 3 spec.

## 9. How to add an endpoint (pattern to follow)

1. Add route + schemas in `packages/api-contract` (`contract/<ns>.contract.ts`, `schema/<ns>.schema.ts`).
2. Rebuild the package (`pnpm --filter @axon/api-contract build`) so `dist/` updates.
3. Add service function in `apps/backend/src/services/<ns>/<ns>.service.ts`.
4. Add controller in `apps/backend/src/controllers/<ns>.controller.ts` (`OrpcHandler`).
5. Wire in `apps/backend/src/router/<ns>.router.ts` via `rpc.<ns>.<op>.handler(handler)`.
6. Add to root `src/router/index.ts` if new namespace.
