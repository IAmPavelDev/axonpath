# Axon — System Architecture

> Status: **DRAFT / pre-beta**. Monorepo last touched 2025-09-20 (~11 months before this doc).
> This document is a faithful snapshot of the code as written. Where a piece is aspirational,
> stubbed, or unwired, it is marked **[PLANNED]**, **[STUB]**, or **[UNWIRED]**.

## 1. One-paragraph summary

Axon is an **adaptive, AI-generated learning app**. A user enters a *topic*; the backend uses
Google Gemini to expand it into an interactive *skill* (Markdown lesson + quiz + retrievable
context snippets). The lesson is delivered as a sequence of focused *classes*; the user reads a
class and answers a quiz; the answers and a personalized context store feed back into the model to
generate the *next* class, so the curriculum adapts to what the user actually gets wrong. The
intended long-term differentiator is a **per-user vector knowledge base** (Postgres `pgvector`)
that the AI retrieves from to keep each follow-up lesson personalized.

## 2. High-level architecture

```mermaid
flowchart LR
    subgraph Mobile["📱 apps/mobile (Expo / React Native)"]
        M[expo-router screens]
        Q[TanStack Query + Zustand]
        RPC[oRPC typed client]
    end

    subgraph Backend["🖥 apps/backend (Fastify + oRPC)"]
        API["/rpc handler — contract-first"]
        C["controllers"]
        S["services"]
        AI["AI service (Gemini)"]
        V["Vector service (Qdrant)"]
        EV["Event log (audit)"]
    end

    subgraph Shared["📦 packages/api-contract"]
        CONTRACTS["contracts + zod schemas"]
    end

    subgraph Infra["Infrastructure"]
        DB[("PostgreSQL 18")]
        QD[("Qdrant v1.19.1 (vectors)")]
        MQ["RabbitMQ [STUB]"]
    end

    M --> RPC --> API
    CONTRACTS --> API
    API --> C --> S
    S --> AI
    S --> V
    S --> EV
    S --> DB
    V --> QD
    S -.->|planned| MQ
```

> Note: `apps/backend/docker-compose-dev.yaml` declares backend, Postgres (plain `postgres:18`, vectors no longer stored here), Qdrant (`qdrant/qdrant:v1.19.1`) and RabbitMQ
> (still a stub). Vector embeddings live in the Qdrant collection `axon_vectors`; Postgres `Vector`
> rows keep only relational metadata. OpenSearch/AWS config and deps were removed.

## 3. Repo layout (pnpm monorepo)

```
axon/
├── apps/
│   ├── backend/          ← Fastify + oRPC API server (TypeScript, tsx dev runner)
│   └── mobile/           ← Expo / React Native app (expo-router, NativeWind)
├── packages/
│   └── api-contract/     ← Shared oRPC contracts + zod schemas (tsup build → dist/)
├── docker-compose-dev.yaml   ← backend + postgres(pgvector) + rabbitmq
├── docker-compose-prod.yaml  ← production backend (build + migrate + node dist)
├── Dockerfile             ← multi-stage (base / build / development)
└── pnpm-workspace.yaml    ← apps/*, packages/*
```

- Dependency manager: **pnpm** (`packageManager: pnpm@10.14.0`).
- Backend dev runner: `tsx` with `tsconfig-paths` and `@/*` path aliases.
- Shared contract package is consumed as a workspace dependency (`@axon/api-contract`).

## 4. Backend (apps/backend) — DDD modular monolith (2026-09 refactor)

Layering: `router/` (thin oRPC wiring) → `modules/*/api` (handlers: parse → use case → error
mapping) → `modules/*/application` (use cases, curried over a deps object = future Effect Layer)
→ `modules/*/domain` (pure types + functions + tagged errors + repository ports) →
`modules/*/infrastructure` (Prisma / Qdrant / OpenRouter adapters). `main.ts` is the composition
root: the only place adapters are constructed.

```
apps/backend/src/
├── main.ts                composition root
├── router/index.ts        buildRouters(container)
├── modules/
│   ├── platform/          Result<T,E>, tagged-error helpers, toORPCError,
│   │                      Clock/JobQueuePort ports, prisma client, set-immediate job queue, config
│   ├── identity/api/      auth.middleware.ts [STUB: hard-coded user 1]
│   ├── learning/          Skill / Class / Question domain, queries+commands,
│   │                      Prisma repos, oRPC handlers
│   ├── tutoring/          AiPort, pure prompt builders, openrouter client,
│   │                      generate-initial-skill use case
│   └── memory/            VectorStorePort (Prisma metadata + Qdrant), retrieval policy
└── prisma/                schema + migrations + generated client
```

Import rules (Effect readiness):
1. `domain/` has zero infra/framework imports (Prisma enum *values* allowed — domain vocabulary).
2. Errors are plain tagged objects `{ kind: "SkillNotFound", ... }` — map 1:1 onto Effect
   `Data.TaggedError`.
3. Use cases return `Result<T, E>` (platform/result.ts, Either-shaped) and are curried over a
   deps object — each deps object becomes an Effect Layer at migration time.
4. Only `infrastructure/` imports prisma/qdrant/openai; only `main.ts` constructs adapters.

### 4.1 RPC surface
Unchanged: `skill.create/edit/get/list`, `class.list/get`, `quiz.get`. `quiz.submit` contract
exists but stays unwired (as before). "Skill/Class not found" now maps to oRPC 404 (previously a
thrown Error → 500).

### 4.2 AI init flow (behavior preserved from the old controller-level runDetached)
`skill.create` → `makeCreateSkill` persists the DRAFT Skill and `jobs.enqueue("skill-init", ...)`
(setImmediate adapter = old fire-and-forget). The job runs `makeGenerateInitialSkill`:
description gen → skill update → embed topic → retrieve prior user context (Qdrant, topK 5) →
generate class+quiz+snippets → audit `SKILL_CREATED` event → persist class (index 0), questions
(batched), `AI_INITIAL` vectors. Failures degrade identically: description/retrieval failure
degrades, generation failure aborts and leaves the skill DRAFT (job logs the error).

### 4.3 What changed structurally
- Controllers/services layer deleted; orchestration lives in use cases.
- `AiPort` (prompt-in/JSON-out transport) + `VectorStorePort` + `JobQueuePort` + `SkillRepository`
  etc. are Promise-based ports; adapters are swappable.
- `runTaskDetached.ts` replaced by `SetImmediateJobQueue`; RabbitMQ stub + amqplib removed
  (JobQueuePort is the seam for a broker).
- Prisma client created in `modules/platform/infrastructure/prisma.ts`; schema/migrations unchanged.
- Per-question create loop replaced by one `createManyAndReturn` batch (same rows, same points).

## 5. Data model (Postgres + Qdrant)

```mermaid
erDiagram
    User ||--o{ Skill : owns
    User ||--o{ Answer : submits
    User ||--o{ Session : has
    User ||--o{ Event : logs
    Skill ||--o{ Class : contains
    Skill ||--o{ Question : has
    Skill ||--o{ Answer : collects
    Skill ||--o{ SkillProgress : tracks
    Skill ||--o{ Event : logs
    Skill ||--o{ Vector : embeds
    Class ||--o{ Vector : embeds
    Class ||--o{ Question : contains
    Question ||--o{ Answer : receives
    Answer ||--o{ Vector : derives

    User { int id PK; string email UK; string password; string firstName; string lastName; enum role; enum status; bool emailVerified; string verificationToken; datetime lastLogin }
    Skill { int id PK; int userId FK; string topic; enum status; float lambda; int requestId UK }
    Class { int id PK; int skillId FK; int index; string title; text contentMd; string aiModel; UNIQUE(skillId,index) }
    Question { int id PK; int skillId FK; int classId FK; enum type; text text; json choices; json answerKey; string aiModel }
    Answer { int id PK; int questionId FK; int userId FK; int skillId FK; json content; float score; bool isCorrect; int timeSpentMs; string device }
    SkillProgress { int id PK; int skillId FK; json snapshot }
    Event { int id PK; int skillId FK; int userId FK; enum type; json payload }
    Vector { int id PK; int skillId FK; int classId FK; int answerId FK; enum source; text textSnippet; int classIndex; int tokenCount }
```

> The agent's embedding (`vector(3072)` in the old model) is now stored only in the Qdrant
> collection `axon_vectors` (C-continuation `Cosine`, point id = `Vector.id`). `Vector` retains
> the relational metadata (`skillId`/`classId`/`answerId`/`source`/`textSnippet`/...).

### Key enums
- **UserRole**: `USER | ADMIN | MODERATOR`
- **UserStatus**: `ACTIVE | SUSPENDED | PENDING_VERIFICATION`
- **SkillStatus**: `DRAFT | ACTIVE | PAUSED | COMPLETED | ARCHIVED`
- **QuestionType**: `MULTIPLE_CHOICE | TRUE_FALSE | OPEN_ENDED`
- **VectorSource**: `AI_INITIAL | AI_NEXT | ANSWER_DERIVED`
- **EventType**: `SKILL_CREATED | CLASS_GENERATED | ANSWER_SUBMITTED | CONTEXT_SELECTED | ERROR_OCCURRED | VECTOR_UPSERTED`

### Notes / tensions
- `Skill.lambda` (default 0.02) suggests a decay/half-life for contextual memory — **unused**.
- `Vector` is `vector(3072)` = Gemini embedding-001 dimensionality.
- `Event` table is a lightweight audit log — currently written only on `SKILL_CREATED` and
  (in commented code) `CLASS_GENERATED`.
- Scaling tokens: `id Int` autoincrement (not UUID). Good enough for beta; revisit for multi-tenant
  scale.

## 6. Mobile (apps/mobile)

```mermaid
flowchart TD
    ROOT["app/_layout.tsx\nQueryClient + Theme + Stack"] --> HOME["app/index.tsx\nskill list"]
    HOME --> SKILL["app/skill/[skillId].tsx\nclass list"]
    SKILL --> CLASS["app/class/[classId]/_layout.tsx\nTabs(conspect/quiz) + ClassProvider"]
    CLASS --> CIDX["index.tsx\nClassConspect (Markdown)"]
    CLASS --> QUIZ["quiz.tsx\nQuiz component"]
    QUIZ --> QUESTION["Question/*\nMC / T-F / Open-ended"]
    QUIZ --> SUBMIT["Submit button\nconsole.log('submit') — DEAD END"]
```

- **RPC client** (`utils/rpc.ts`): typed oRPC client over fetch; URL hard-coded to
  `http://10.0.2.2:3001/rpc` (Android emulator loopback) with a dummy Bearer header.
- **State**: TanStack Query for server data; **Zustand** (`quiz.store`) for in-screen quiz answers.
- **Screens present**: skill list, class list, class conspect (Markdown), quiz (3 question types).
- **Dead ends / gaps**:
  - **No "create skill" UI** anywhere (the API supports it, the app can't reach it).
  - **Submit button `console.log('submit')`** — no submission, no `rpc.quiz.submit` call.
  - Answers are held in Zustand but never sent to the backend.
  - No progress, no "next class", no adaptive follow-up in the UI.
  - `ClassQuiz.tsx` is an empty stub (`return <></>`).
- UI kit (button/input/textarea/checkbox/spinner/text/separator/icon) from react-native-reusables.

## 7. Environment & config

`.env` (root) declares:
| Key | Used for |
|---|---|
| `DATABASE_URL` | Prisma → Postgres |
| `QDRANT_URL` | Qdrant vector store (REST 6333) |
| `NODE_ENV` | Runtime mode |
| `APP_PORT` (default 3000) | HTTP port; compose maps **3001:3001** |
| `APP_HOST` (default 0.0.0.0) | Bind host |
| `GEMINI_API_KEY` | Google Gemini auth |

`src/config.ts` (backend) defaults — each is a `process.env` override, not a literal
(`QDRANT_URL`, `LAMBDA_DECAY_DEFAULT`):
```
qdrant.url        = http://localhost:6333   (docker-compose: http://qdrant:6333)
ai.models.weak    = gemini-2.0-flash-lite
ai.models.pro     = gemini-2.5-pro
ai.models.embedding = gemini-embedding-001
lambda default    = 0.02
```

> RabbitMQ URL is a **literal** in `queue.service.ts` (`amqp://user:password@localhost`) — not from
> env.

## 8. Infrastructure (docker-compose)

**dev** (`docker-compose-dev.yaml`): backend (volume mounts source),
`postgres:18` (Postgres 18, on 5432), `qdrant/qdrant:v1.19.1` (6333 REST /
6334 gRPC), `rabbitmq:3.12-management` (5672/15672). Backend auto-runs `prisma migrate deploy` +
`prisma generate` + `dev:watch`.

**prod** (`docker-compose-prod.yaml`): mounts repo, runs `prisma migrate deploy` + `tsc build` +
`node dist/main.js`; maps 3001:3001.

> ⚠️ Verified gaps: the Dockerfile has **no `production` stage**, so the prod compose build falls
> through to the last stage (`development`) — prod runs on the dev image. And
> `DATABASE_URL=${DATABASE_HOST}` in `docker-compose-prod.yaml` is a real wiring bug (see ROADMAP W4).

## 9. What this codebase is today

**Working, end-to-end happy path (single-user, dev-only):**
Mobile → skill list → class list → class conspect → quiz rendering works against a running
backend.

**What is missing to call it a product (all [PLANNED]):**
1. Real auth (currently one hard-coded user).
2. Create-skill entry point in the UI.
3. Answer submission + scoring (`quiz.submit` not wired; `submitAnswers` is a stub).
4. The **adaptive next-class loop** (`generateNextClass` commented out) — the core idea.
5. ~~Vector retrieval (vectors written, never read)~~ — live: `searchSimilar` (Qdrant, filtered by
   `userId`) feeds prior user context into `generateInitSkill`. Next-class retrieval still pending.
6. Progress tracking (`SkillProgress` table unused).
7. Adult lifecycle: status transitions, error surfacing to client, observability.
