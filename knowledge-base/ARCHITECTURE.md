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
        V["Vector service (pgvector)"]
        EV["Event log (audit)"]
    end

    subgraph Shared["📦 packages/api-contract"]
        CONTRACTS["contracts + zod schemas"]
    end

    subgraph Infra["Infrastructure"]
        DB[("PostgreSQL 16 + pgvector")]
        MQ["RabbitMQ [STUB]"]
        OS["OpenSearch [UNWIRED]"]
    end

    M --> RPC --> API
    CONTRACTS --> API
    API --> C --> S
    S --> AI
    S --> V
    S --> EV
    S --> DB
    AI --> DB
    V --> DB
    S -.->|planned| MQ
    V -.->|deprecated intent| OS
```

> Note: `apps/backend/docker-compose-dev.yaml` also declares RabbitMQ and pgvector containers.
> RabbitMQ is a stub (no consumer wiring); OpenSearch config exists but nothing uses it — the
> system actually stores vectors in Postgres `pgvector` instead.

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

## 4. Backend (apps/backend)

### 4.1 Server bootstrap (`src/main.ts`)
- Fastify server with a **custom `serverFactory`** so the raw Node server can route:
  1. **`/rpc`** — oRPC `RPCHandler` serving the contract-first router.
  2. **`/spec.json`** — generated OpenAPI 3 spec (from `@orpc/openapi` + Zod→JSON-Schema).
  3. **`/`** — Scalar API-reference docs page (renders `/spec.json`).
  4. **everything else** — Fastify routes: `/health`, `/ready`, `/info`.
- Env loading via `@fastify/env` (dotenv). Global error + not-found handlers, graceful shutdown
  on SIGTERM/SIGINT.
- **Note:** custom `serverFactory` bypasses normal Fastify routing for `/rpc`, so conventions like
  `@fastify/cors` do not apply to RPC — CORS is handled by oRPC's `CORSPlugin` instead.

### 4.2 Contract-first RPC (oRPC)
```mermaid
graph LR
    A["@axon/api-contract\n(oc.route + zod)"] --> B["src/lib/orpc.ts\nrpc = implement(contract)\n.$context().use(authMiddleware)"]
    B --> C["routers (skill/class/quiz)"]
    C --> D["controllers"]
    D --> E["services"]
    E --> F["prisma (Postgres)"]
    E --> G["AI service (Gemini)"]
```
- **Contract** lives in `packages/api-contract` (`skill`, `class`, `quiz` sub-routers).
- **Implementation** wires contract → router → controller via `rpc.<ns>.<op>.handler(handler)`.
- Every controller receives `{ input, context }`; `context.user` is injected by `authMiddleware`.

### 4.3 Current RPC surface (implemented)
| Method | Path | Description |
|---|---|---|
| `skill.create` | POST `/skill/create` | Create a `Skill` (DRAFT), then **fire-and-forget** AI init |
| `skill.list` | GET `/skill/list` | List current user's skills |
| `class.list` | GET `/class/list` | List classes of a skill |
| `class.get` | GET `/class/:id` | Fetch one class (title + `contentMd`) |
| `quiz.get` | GET `/quiz/:id` | Fetch questions for a class |

> **Notice the gap:** `quiz.submit` contract exists but **has no router/handler** in
> `router/quiz.router.ts` (only `get` is wired). The mobile Submit button calls nothing.

### 4.4 Services
- **skill.service** — `createSkill`, `getSkillsList`. Thin CRUD over Prisma.
- **class.service** — `createClass`, `getClassesList`, `getClassById`. Thin CRUD.
- **quiz.service** — `createQuestion`, `createAnswer`, `getQuestionsByClassId`, `submitAnswers`.
  - `submitAnswers` is **incomplete**: it loads the questions but never records or scores answers
    via `createAnswer`. `createAnswer` exists but the submit flow does not call it.
  - `quiz.router.ts` does not expose `submit`, so the whole answer flow is dead.
- **ai.service** — Gemini wrapper. Implements `generateInitSkill` (builds first class + quiz +
  context snippets + embeddings) and `generateEmbeddings`. `generateNextClass` is **commented
  out** — this is the core adaptive loop that is not yet wired.
- **vector.service** — raw SQL inserts of `Vector` rows (embedding JSON → `::vector` cast) into
  Postgres pgvector. No retrieval/search implemented.
- **queue.service** — a RabbitMQ wrapper class; **no producer/consumer integration** (stub).

### 4.5 Auth middleware (`src/middleware/auth.ts`) — **[STUB / insecure]**
```mermaid
flowchart LR
    A[incoming request] --> B[authMiddleware]
    B --> C{upsert user id=1}
    C -->|exists| D[reuse user 1 / update lastLogin]
    C -->|missing| E[create dev user John Doe / ADMIN]
    D --> F[next context.user = user]
    E --> F
```
- **Hard-coded user.** Every request is treated as user id **1** (`john.doe@example.com`, ADMIN).
  It upserts that user and injects it into context. There is **no real authentication** — no
  password validation, no tokens, no per-request identity.
- Mobile sends `authorization: Bearer token` header, but the server ignores it.

### 4.6 AI flow — skill creation (currently the only "smart" path)
```mermaid
sequenceDiagram
    participant U as Client (mobile)
    participant C as SkillController
    participant H as runDetached (setImmediate)
    participant AI as Gemini
    participant DB as Postgres

    U->>C: rpc.skill.create(topic)
    C->>DB: create Skill(DRAFT)
    C--)H: runDetached(initSkill)
    H->>AI: generateInitSkill(topic)
    AI-->>H: { classTitle, classContentMd, questions[], contextSnippets[] }
    H->>DB: create Class(index 0)
    H->>DB: create Question[] (per question)
    H->>AI: generateEmbeddings(contextSnippets)
    H->>DB: insert Vector[] (source=AI_INITIAL)
    H-->>C: (background; client got id+status already)
```

Key observations:
- The client receives the `Skill` (id + status) **immediately**; all AI work happens in a
  detached `setImmediate` callback via `runDetached`.
- Status stays `DRAFT` — nothing ever transitions it to `ACTIVE`.
- The whole init pipeline is **not transactional** and is not observable by the client (no
  progress/status channel).
- `Vector` rows are persisted but **never read back** (no retrieval).

## 5. Data model (Postgres + pgvector)

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
    Vector { int id PK; int skillId FK; int classId FK; int answerId FK; vector(3072) embedding; enum source; text textSnippet; int classIndex; int tokenCount }
```

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
| `DATABASE_URL` | Prisma → Postgres (pgvector) |
| `NODE_ENV` | Runtime mode |
| `APP_PORT` (default 3000) | HTTP port; compose maps **3001:3001** |
| `APP_HOST` (default 0.0.0.0) | Bind host |
| `GEMINI_API_KEY` | Google Gemini auth |

`src/config.ts` (backend) additionally hard-codes:
```
aws.region        = us-east-1
vectorDb.endpoint = https://your-opensearch-endpoint   [placeholder — unused]
ai.models.weak    = gemini-2.0-flash-lite
ai.models.pro     = gemini-2.5-pro
ai.models.embedding = gemini-embedding-001
lambda default    = 0.02
```

> RabbitMQ URL is a **literal** in `queue.service.ts` (`amqp://user:password@localhost`) — not from
> env.

## 8. Infrastructure (docker-compose)

**dev** (`docker-compose-dev.yaml`): backend (volume mounts source), `postgres:pgvector/pgvector:16`
(on 5432), `rabbitmq:3.12-management` (5672/15672). Backend auto-runs `prisma migrate deploy` +
`prisma generate` + `dev:watch`.

**prod** (`docker-compose-prod.yaml`): mounts repo, runs `prisma migrate deploy` + `tsc build` +
`node dist/main.js`; maps 3001:3001.

## 9. What this codebase is today

**Working, end-to-end happy path (single-user, dev-only):**
Mobile → skill list → class list → class conspect → quiz rendering works against a running
backend.

**What is missing to call it a product (all [PLANNED]):**
1. Real auth (currently one hard-coded user).
2. Create-skill entry point in the UI.
3. Answer submission + scoring (`quiz.submit` not wired; `submitAnswers` is a stub).
4. The **adaptive next-class loop** (`generateNextClass` commented out) — the core idea.
5. Vector **retrieval** (vectors written, never read).
6. Progress tracking (`SkillProgress` table unused).
7. Adult lifecycle: status transitions, error surfacing to client, observability.
