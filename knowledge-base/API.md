# Axon — API Surface (REST/JSON, OpenAPI-generated)

> Source of truth: **`packages/api-contract/src/routes.ts`** (route table) + the zod schemas in
> `packages/api-contract/src/schema/`. The committed spec `packages/api-contract/openapi.json` is
> emitted from the table (`pnpm --filter @axon/api-contract build`) and drift-checked in CI.
> This doc mirrors the actual code (rewritten 2026-10-28 for the oRPC → OpenAPI cutover).

## 1. Transport

- Plain **REST/JSON on Fastify** — no RPC envelope: success responses carry the bare output object;
  failures carry the flat error body (§3). The old oRPC `{"json": …}` envelope is gone.
- Single server (`buildApp()` in `apps/backend/src/app.ts`) serves:
  - the 24 API routes (§2), all behind Firebase auth (§2 note);
  - `GET /spec.json` — the committed OpenAPI **3.0.3** artifact, served verbatim;
  - `GET /` — Scalar docs UI pointed at `/spec.json`;
  - Fastify-native `GET /health`, `GET /ready`, `GET /info`.
- Requests ride the Lambda (`axon-api`, serverless-http → `app.routing`) behind API Gateway
  (eu-central-1); API Gateway caps requests at 30 s.
- Client: **generated Kotlin Retrofit client** (openapi-generator, `jvm-retrofit2` +
  kotlinx-serialization) from the committed spec. `apps/android` never hand-writes paths or
  payload shapes; `data/api/AxonApi.kt` is a thin mapping facade onto the generated services.
- Batching: the old oRPC client coalesced parallel screen-mount calls into one `/rpc/__batch__`
  round trip. That is gone (D9) — screens launch parallel suspend calls (~60 ms RTT, wall time
  comparable). See GAPS.md.

## 2. Route table (24 routes — all require auth)

Auth = `Authorization: Bearer <Firebase ID token>` on **every** API route; the Fastify
preValidation hook (`apps/backend/src/lib/auth-hook.ts`) verifies against Google's public keys and
resolves/provisions the local User row onto `request.user`. Health/ready/info/spec/docs are
unauthenticated. Auth failures → 401 `{"code":"UNAUTHORIZED","message":…}`.

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/auth/me` | — | `MeOutput` |
| GET | `/skill/list` | query `includeArchived?` (default false) | `GetSkillListOutput` |
| POST | `/skill/create` | body `CreateSkillInput` | `CreateSkillOutput` |
| GET | `/skill/{id}` | path | `GetSkillByIdOutput` |
| POST | `/skill/{id}/edit` | path + body `{topic?, description?}` | `StatusOnly` |
| POST | `/skill/{id}/retry` | path | `StatusOnly` |
| GET | `/skill/{id}/progress` | path | `SkillProgressOutput` |
| POST | `/skill/{id}/status` | path + body `{status}` | `StatusOnly` |
| DELETE | `/skill/{id}` | path | `{deleted: true}` |
| GET | `/skill/{id}/mistakes` | path | `SkillMistakesOutput` |
| GET | `/class/list` | query `skillId` | `GetClassListOutput` |
| GET | `/class/{id}` | path | `GetClassByIdOutput` |
| GET | `/class/qa/list` | query `classId` | `ListClassQaOutput` |
| POST | `/class/qa/ask` | body `AskClassQuestionInput` | `AskClassQuestionOutput` |
| POST | `/class/qa/retry` | body `RetryClassQaInput` | `AskClassQuestionOutput` |
| GET | `/quiz/{classId}` | path | `GetQuizByClassIdOutput` |
| POST | `/quiz/{classId}/submit` | path + body `{answers[]}` | `SubmitQuizAnswersOutput` |
| GET | `/quiz/{classId}/result` | path | `GetQuizResultOutput` |
| GET | `/video/recommendations/list` | query `skillId` | `SkillRecommendationsOutput` |
| POST | `/video/recommendations/refresh` | body `{skillId}` | `RefreshRecommendationsOutput` |
| GET | `/video/sponsor-segments` | query `videoId` | `SponsorSegmentsOutput` |
| POST | `/video/probe` | body `ProbeYouTubeAccessInput` | `ProbeYouTubeAccessOutput` |
| GET | `/stats/overview` | — | `StatsOverviewOutput` |
| GET | `/usage/report` | query `skillId?` | `UsageReportOutput` |

Wire notes:

- Path/query values arrive as strings; the Fastify layer coerces number/boolean leaves before
  zod validation (schema-informed probe in `apps/backend/src/lib/routes.ts`). Failures → 422.
- `createdAt`-style fields are **ISO-8601 strings** on the wire (`z.date()` ↔ date-time JSON
  Schema; Fastify serializes `Date` → ISO; Kotlin maps them as `String`).
- `POST /quiz/{classId}/submit` answers synchronously; long class-qa answers ride the worker tick
  (≤2 min) — unchanged from the previous build.
- `POST /video/probe` is a deployment-time diagnostic, documented in the public spec by design (D7).

## 3. Error model (D6)

Flat body + real HTTP status on every failure:

```json
{"code": "NOT_FOUND", "message": "…"}
```

- Codes reuse the previous transport's vocabulary: `BAD_REQUEST`, `UNAUTHORIZED`, `NOT_FOUND`,
  `CONFLICT`, `VALIDATION`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`, `FORBIDDEN`.
- Statuses: 400/401/403/404/409/422/429/500 per code (oRPC's COMMON_ERROR_STATUS_MAP baseline).
- Domain mapping (`toHttpError` in `modules/platform/api/error-mapping.ts`): tagged
  `*NotFound`/`NotOwned` → 404 (NotOwned hides behind 404 so skill existence never leaks);
  `InvalidSkillTransition`/`*NotAllowed` → 409; zod input failures → 422 `VALIDATION`;
  untyped throws → generic 500, internals never leak.
- Kotlin side: `ApiException(status, code, message)` parsed from the error body.

## 4. Spec & client generation chain

```
schema/*.ts (zod, unchanged — D2)
  → routes.ts (method+path+schemas meet exactly once — D3)
    → emit-openapi.ts → openapi.json (committed, CI-drift-checked — D4)
      ├── backend: lib/routes.ts registers all 24 Fastify routes FROM the table
      └── android: gradle openApiGenerate → com.iampavlo.axon.data.generated.* (D5)
```

## 5. How to add an endpoint

1. Add the zod schema in `packages/api-contract/src/schema/<ns>.schema.ts`.
2. Add a `RouteDef` entry in `packages/api-contract/src/routes.ts` (path placeholders must match
   the schema field names).
3. `pnpm --filter @axon/api-contract build` — regenerates `openapi.json` (committed).
4. Add the handler in `apps/backend/src/modules/<ns>/api/<ns>.handlers.ts` and register it under
   its operationId in `apps/backend/src/router/index.ts` (`buildApiHandlers`). Registration fails
   loudly if an operationId is missing.
5. Regenerate the Kotlin client (automatic on next `./gradlew` build) and extend the
   `AxonApi` facade + dtos mapping if the UI consumes it.
6. Drift check: rebuilding the contract with an unchanged `openapi.json` is a no-op; a schema
   change without re-emitting fails CI (`spec-drift` job).
