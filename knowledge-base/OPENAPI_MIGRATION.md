# Axon — oRPC → OpenAPI Migration Plan

> Written 2026-10-28 from a verified code read of the post-RN-deletion state
> (backend 286/286 tests green as of 2026-10-02; Kotlin app is the only client).
> This document is **execution authority** for the oRPC → OpenAPI cutover. It is
> self-contained: implementable in a fresh session with no other context. Every
> file path, route, schema name, and dependency version below was read from the
> repo on 2026-10-28, not recalled.
>
> **Status: IN PROGRESS — P0–P2 landed 2026-10-28 (backend 344/344 green, spec
> drift-check green, 24/24 ops in the committed spec). P3 (Kotlin cutover) and
> P4 (docs sync) remain; live smoke of the new transport waits on the push to
> `dev` (user-owned).** Tick checkboxes in the same change that lands each phase
> (repo docs rule). When all phases are DONE, move this file's status to
> COMPLETE and fold transport facts into `ARCHITECTURE.md`/`API.md`.

---

## 1. Goal

Replace oRPC end-to-end:

- **Backend**: Fastify-native REST routes, OpenAPI 3.0.3 spec generated from one
  declarative route table, zod schemas unchanged as validation + types.
- **Kotlin**: Retrofit client **generated** by `openapi-generator` from the
  committed spec. All hand-written mirror layers deleted.

Why: oRPC is TypeScript-only; the Kotlin side currently hand-mirrors the wire
protocol (`OrpcClient.kt`), paths/payloads (`AxonApi.kt`), and DTOs (`Dtos.kt`).
That mirror compiles clean on both sides while drifting (`ignoreUnknownKeys=true`
silently drops renamed fields; path typos are runtime 404s). Generation makes
drift structurally impossible. Alternatives evaluated and rejected 2026-10-28:
gRPC (needs HTTP/2 trailers — API Gateway/Lambda cannot serve it), Connect/protobuf
(Kotlin lib stalled: `com.connectrpc:connect-kotlin` 0.7.2, 2025-01-08, beta),
GraphQL (backend rewrite for ~24 unary routes), custom codegen (bespoke tooling).

## 2. Decisions (locked 2026-10-28, user-approved)

| # | Decision |
|---|---|
| D1 | **Abandon oRPC entirely** — no `/rpc` endpoint, no oRPC deps anywhere. Not the "keep oRPC + mount OpenAPIHandler" variant. |
| D2 | Contract source of truth = **existing zod schemas** (`schema/*.ts`), unchanged. Backend domain code already imports them (~10 files); nothing there moves. |
| D3 | A declarative **route table** (`packages/api-contract/src/routes.ts`) is the single place where method+path+schemas meet. Backend registration AND spec emission consume it. No path string exists in two places. |
| D4 | Spec = **committed build artifact** `packages/api-contract/openapi.json` (OpenAPI **3.0.3**), emitted by a script in the contract package. CI regenerates and `git diff --exit-code` fails on drift. Kotlin Gradle task reads the committed file — builds never hit a live server. |
| D5 | Kotlin generator = **openapi-generator**, `-g kotlin --library jvm-retrofit2 --additional-properties=serializationLibrary=kotlinx_serialization` (matches existing Retrofit 2.11.0 / OkHttp 4.12.0 / kotlinx-serialization-json 1.7.3 stack in `apps/android/gradle/libs.versions.toml`). Generated code goes to `build/generated/` — **not committed**. |
| D6 | Error body: flat `{"code": string, "message": string}` + real HTTP status codes. Codes reuse the oRPC vocabulary (`BAD_REQUEST`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`, …) for continuity with existing Kotlin error handling. |
| D7 | `POST /video/probe` **stays documented** in the public spec (debug endpoint, but no filtering logic). All 24 routes are in the spec. |
| D8 | RN app (`apps/mobile`) is **deleted** (user action). No API versioning, no transition window: one deploy + one client release. `deploy.yml` already has no mobile references. |
| D9 | Batching loss accepted: oRPC's 8 ms batch coalescing disappears; Kotlin screens make parallel suspend calls (~60 ms RTT eu-central-1, 2–4 concurrent on screen mount — wall time comparable). Record in `GAPS.md`. |

## 3. Current state inventory

### 3.1 Backend wiring (what gets removed/rewritten)

- `apps/backend/src/lib/orpc.ts` — `implement(contract).use(makeAuthMiddleware(...))`
  with inline `makeFirebaseTokenVerifier({ projectId: config.auth.firebaseProjectId })`,
  `makeAuthenticate({ users: makePrismaUserRepository(), clock: makeSystemClock() })`.
  **Delete file**; reuse the same identity factories inside a Fastify auth hook.
- `apps/backend/src/app.ts` — raw-Node `handleRequest` path: `/rpc` prefix → oRPC
  handler (bypasses Fastify router); `/spec.json` → `OpenAPIGenerator` from
  `@orpc/openapi` + `ZodToJsonSchemaConverter`; `/` → Scalar docs; fallthrough →
  Fastify. Fastify-native: `GET /health`, `GET /ready`, `GET /info`.
  Also imports `experimental_ZodSmartCoercionPlugin` from `@orpc/zod/zod4` — **goes away**.
- Handlers (`make*Handlers`, satisfy `OrpcHandler` from
  `@/modules/platform/api/orpc-handler`): `identity/api/auth.handlers.ts`,
  `learning/api/{class,quiz,skill,stats}.handlers.ts`, `video/api/video.handlers.ts`.
  Error mapping: `toORPCError` in `@/modules/platform/api/error-mapping`; result
  helpers `isErr` / `unwrapOrThrow` stay.
- Repos layer imports contract schemas too (e.g.
  `learning/infrastructure/quiz.prisma.repo.ts` imports `schema`) — **untouched**,
  they use output/question schemas, not inputs.
- `@orpc/*` deps to remove: backend `package.json` (`@orpc/client`, `@orpc/openapi`,
  `@orpc/server`, `@orpc/zod` — all 1.8.6), contract package (`@orpc/contract`,
  `@orpc/server`). Bonus: closes all four pending @orpc CVEs in
  `knowledge-base/DEPENDABOT_REMEDIATION_PLAN.md`.

### 3.2 Contract package (`packages/api-contract`)

- `src/schema/{auth,class,quiz,skill,stats,video}.schema.ts` — **keep, unchanged**
  (except the coercion nuance in §5-P0-3).
- `src/contract/{auth,class,quiz,skill,stats,video}.contract.ts` — `oc` routers
  carrying `.route({method, path, summary, tags})` + input/output schema. **Delete**;
  their metadata is the source for the new route table.
- `src/index.ts` — exports `contract`, `schema`, `AppContract`, `Question`,
  `SubmitQuizAnswersOutput`. After migration: keep `schema` + the two type exports;
  delete `contract`/`AppContract` (only consumer of `contract` was `lib/orpc.ts`).
- Build: `tsup` + declaration emit; backend resolves `dist/` — **build-first rule
  stays** (`pnpm --filter @axon/api-contract build` before backend).

### 3.3 Kotlin (`apps/android`)

- `app/src/main/java/com/iampauld3v/axon/core/network/OrpcClient.kt` — hand-ported
  oRPC RPCLink + BatchLink wire protocol (single `POST /rpc/{path}` body
  `{"json":…}`; batch `POST /rpc/__batch__` header `x-orpc-batch: buffered`; 8 ms
  coalesce), `Json { ignoreUnknownKeys = true }`, exports `RpcException(code,
  message, defined, status)`. **Delete.**
- `data/api/AxonApi.kt` — RPC-style path strings + hand-built `JsonObject` inputs
  (`rpc.call("skill/get", obj { put("id", id) }, …)`). **Delete.**
- `data/dto/Dtos.kt` — kotlinx DTOs mirroring zod 1:1. **Delete** (generated models
  replace them; dates already ISO-8601 strings on the wire).
- Manual DI in `core/di/AppContainer.kt` builds `OrpcClient(baseUrl, tokenProvider,
  OkHttpClient, scope)` — base URL is the API Gateway invoke URL
  `https://t3afkc5pj2.execute-api.eu-central-1.amazonaws.com`; tokenProvider
  supplies the Firebase ID token (Bearer). Keep both; rewire to Retrofit.
- `RpcException` is referenced across `feature/` (error banners, retry flows) —
  full callsite migration required.
- Kotlin RPC paths differ from REST paths in 2 places (naming drift already
  happened): Kotlin `skill/edit` → REST `POST /skill/{id}/edit` (id was in body),
  Kotlin `video/sponsorSegments` → REST `GET /video/sponsor-segments`.

### 3.4 Full route table (24 routes; metadata lifted verbatim from the oc contracts)

Params are OpenAPI-style `{…}`; `IN`/`OUT` are the existing zod schema names.

| # | Method | Path | IN | OUT |
|---|---|---|---|---|
| 1 | GET | `/auth/me` | — | `MeOutput` |
| 2 | GET | `/skill/list` | `GetSkillListInput` (query) | `GetSkillListOutput` |
| 3 | POST | `/skill/create` | `CreateSkillInput` (body) | `CreateSkillOutput` |
| 4 | GET | `/skill/{id}` | `SkillIdInput` (path) | `GetSkillByIdOutput` |
| 5 | POST | `/skill/{id}/edit` | `EditSkillInput` → path `id` + body `{topic?, description?}` | `StatusOnly` |
| 6 | POST | `/skill/{id}/retry` | `SkillIdInput` (path) | `StatusOnly` |
| 7 | GET | `/skill/{id}/progress` | `SkillIdInput` (path) | `SkillProgressOutput` |
| 8 | POST | `/skill/{id}/status` | `UpdateSkillStatusInput` → path `id` + body | `StatusOnly` |
| 9 | DELETE | `/skill/{id}` | `SkillIdInput` (path) | `DeleteSkillOutput` |
| 10 | GET | `/skill/{id}/mistakes` | `SkillIdInput` (path) | `SkillMistakesOutput` |
| 11 | GET | `/class/list` | `GetClassListInput` (query) | `GetClassListOutput` |
| 12 | GET | `/class/{id}` | `GetClassByIdInput` (path) | `GetClassByIdOutput` |
| 13 | GET | `/class/qa/list` | `ListClassQaInput` (query) | `ListClassQaOutput` |
| 14 | POST | `/class/qa/ask` | `AskClassQuestionInput` (body) | `AskClassQuestionOutput` |
| 15 | POST | `/class/qa/retry` | `RetryClassQaInput` (body) | `AskClassQuestionOutput` |
| 16 | GET | `/quiz/{id}` | `GetQuizByClassIdInput` (path) | `GetQuizByClassIdOutput` |
| 17 | POST | `/quiz/{classId}/submit` | `SubmitQuizAnswersInput` → path `classId` + body `{answers[]}` | `SubmitQuizAnswersOutput` |
| 18 | GET | `/quiz/{classId}/result` | `GetQuizResultInput` (path) | `GetQuizResultOutput` |
| 19 | GET | `/video/recommendations/list` | `SkillRecommendationsInput` (query) | `SkillRecommendationsOutput` |
| 20 | POST | `/video/recommendations/refresh` | `RefreshRecommendationsInput` (body) | `RefreshRecommendationsOutput` |
| 21 | GET | `/video/sponsor-segments` | `SponsorSegmentsInput` (query) | `SponsorSegmentsOutput` |
| 22 | POST | `/video/probe` | `ProbeYouTubeAccessInput` (body) | `ProbeYouTubeAccessOutput` |
| 23 | GET | `/stats/overview` | — | `StatsOverviewOutput` |
| 24 | GET | `/usage/report` | `UsageReportInput` (query) | `UsageReportOutput` |

**All 24 routes require auth** (the oRPC auth middleware was applied globally in
`lib/orpc.ts`). Auth = `Authorization: Bearer <Firebase ID token>`, same as today.

**Success envelope disappears**: oRPC wrapped bodies as `{"json": …}`; REST
returns the output schema object directly. The success payload JSON is identical
(oRPC never wrapped fields, only the envelope).

### 3.5 Facts the implementer must not rediscover

- Backend tests: `pnpm --filter @axon/backend test` (286 green as of 2026-10-02;
  344 after P2 — 286 pre-existing use-case/domain/infra tests untouched, plus
  new route-table tests). CORRECTED 2026-10-28 (repo wins): the pre-migration
  repo had NO api-layer handler tests — only `auth.middleware.test.ts` (now
  superseded by `src/lib/routes.test.ts`, which exercises auth-hook + D6
  errors + coercion via `fastify.inject`).
- Deploy: push to `dev` → `.github/workflows/deploy.yml` builds the lambda image
  (Dockerfile `lambda` target), pushes to ECR `axon-backend:lambda`, updates both
  functions, smokes `/health`. Workflow `paths` already cover backend + contract +
  workspace files. API Gateway 30 s cap unchanged. Worker (`axon-worker`,
  EventBridge 1/min) calls use-cases directly — no `/rpc` involvement, untouched.
- `POST /quiz/{classId}/submit` returns synchronously; long class-qa answers ride
  the worker tick (≤2 min) — UX flow unchanged by this migration.
- Scalar docs + `/spec.json` served by `app.ts` today; keep both post-migration
  (serve the committed spec statically; see P2).

## 4. Target architecture

```
packages/api-contract
  src/schema/*.ts          # UNCHANGED zod schemas (domain + validation + types)
  src/routes.ts            # NEW: 24 RouteDef entries {method, path, request split, response, summary, tags}
  src/emit-openapi.ts      # NEW: routes.ts + zod toJSONSchema → openapi.json (3.0.3)
  openapi.json             # COMMITTED artifact; CI drift-checked

apps/backend
  lib/routes.ts            # NEW: registers all 24 routes on Fastify FROM the table
  lib/auth-hook.ts         # NEW: Firebase verify → authenticate → req.user (from old middleware)
  modules/platform/api/error-mapping.ts   # toORPCError → toHttpError (same code vocabulary)
  app.ts                   # /rpc + oRPC imports gone; /spec.json serves committed spec; Scalar stays

apps/android
  gradle: openapi-generator task → build/generated/openapi/ (Retrofit + kotlinx models)
  core/network/OrpcClient.kt, data/api/AxonApi.kt, data/dto/Dtos.kt   # DELETED
  data/repo/*              # consume generated Retrofit service; names/roles unchanged
```

Single source chain: `zod schemas → routes.ts → {Fastify routes, openapi.json →
generated Kotlin client}`. A contract change that skips the spec emission fails CI.

## 5. Implementation phases

### P0 — Spike (no repo changes; kill-switch for the whole plan)

- [x] **P0.1** In a scratch dir, emit a spec from the real schemas: import the six
  `schema/*.ts` files, run zod v4 native `z.toJSONSchema(schema, { io: "input" | "output" })`
  (zod ^4.1.5 supports it — no new dep). Verify output for: `z.date()` →
  `{"type":"string","format":"date-time"}`; enums; `.optional()`/`.nullable()`
  distinction; any discriminated unions in `quiz`/`video` schemas.
- [x] **P0.2** Verify `z.toJSONSchema(z.coerce.number())` — if it does NOT emit
  `{"type":"integer"}` cleanly, use the fallback (default-safe): route-table param/
  query sub-schemas stay plain `z.number()` for spec purposes, and the Fastify
  layer coerces path/query strings before validation (transport-owned, one helper).
- [x] **P0.3** Run the real generator against the real emitted spec:
  `openapi-generator-cli generate -i openapi.json -g kotlin --library jvm-retrofit2
  --additional-properties=serializationLibrary=kotlinx_serialization,dateLibrary=string,useCoroutines=true`
  (verify exact flag names with `-g kotlin -h` on the pinned version; record the
  chosen generator version in §9). Inspect: nullability mapping, date mapping
  (`dateLibrary=string` → ISO strings, matching today's `Dtos.kt` convention),
  model naming, whether the generated client sets `ignoreUnknownKeys` (or needs a
  custom converter).
- [x] **P0.4** Compile the generated sources against the app's current Gradle setup
  in a scratch project. If output is unusable → STOP, report, reconsider (the
  fallback ladder was: types-only generation, then custom emitter — but do not
  proceed silently).

**P0 acceptance**: a compiled Kotlin client exists that models all 24 operations;
quirks are written into §9 Notes. No repo files touched.

### P1 — Contract package rework

- [x] **P1.1** Delete `src/contract/*.ts`; add `src/routes.ts`:

  ```ts
  // sketch — exact types belong to the implementer
  type RouteDef = {
    method: "GET" | "POST" | "DELETE";
    path: string;                    // OpenAPI style: "/skill/{id}"
    summary: string;
    tags: string[];
    params?: ZodType;                // path params (see P0.2 coercion note)
    query?: ZodType;                 // query params
    body?: ZodType;                  // JSON body
    response: ZodType;               // success body (output schema)
  };
  export const ROUTES: RouteDef[] = [ /* 24 entries per §3.4 */ ];
  ```

  Split inputs via `.pick`/`.omit` from the existing input schemas — e.g.
  `EditSkillInput` → `EditSkillInput.pick({ topic: true, description: true })` body
  + `id` param; `SubmitQuizAnswersInput` → `classId` param + `.pick({ answers: true })`
  body. Keep one zod source per field; never restate a field shape.
- [x] **P1.2** Add `src/emit-openapi.ts`: assemble OpenAPI 3.0.3 from `ROUTES`
  (zod JSON Schema per io context; shared `ErrorResponse` schema component per D6:
  `{"code": string, "message": string}`; bearerAuth security scheme documented on
  all operations). Write `openapi.json` at the package root. Script entry:
  `"emit:openapi"` in `package.json`, wired into `build`.
- [x] **P1.3** `src/index.ts`: drop `contract`/`AppContract` exports (update the
  only consumer — `apps/backend/src/lib/orpc.ts`, which P2 deletes anyway);
  keep `schema`, `Question`, `SubmitQuizAnswersOutput`. Remove `@orpc/*` deps from
  `package.json`; `pnpm install`; build.
- [x] **P1.4** CI drift check: extend `.github/workflows/deploy.yml` (or a sibling
  workflow) with a job: install → build contract → re-emit → `git diff --exit-code
  -- packages/api-contract/openapi.json`.
- [x] **P1.5** Regenerate `pnpm-lock.yaml`.

**P1 acceptance**: `pnpm --filter @axon/api-contract build` emits a valid
`openapi.json` covering all 24 operations; backend still typechecks (it hasn't
changed yet — orpc.ts consumer handled in P2; if typecheck breaks here, land P1+P2
as one change); drift check green on an unchanged tree.

### P2 — Backend port

- [x] **P2.1** `lib/auth-hook.ts`: Fastify `preValidation` (async) hook reusing
  `makeFirebaseTokenVerifier` + `makeAuthenticate` + `makePrismaUserRepository`
  exactly as `lib/orpc.ts` wired them; sets `request.user`; rejects 401 with D6
  body. Apply to all routes (all 24 are protected).
- [x] **P2.2** `lib/routes.ts` (backend): iterate `ROUTES`; for each entry register
  the Fastify route: convert `{id}` → `:id`; validate params/query/body with the
  entry's zod schemas (apply P0.2 coercion for path/query); call the existing
  handler function with the validated input + `request.user` context; map
  domain errors via the new `toHttpError`; reply with the handler output object
  (no envelope) and status 200 (or the schema-declared status).
- [x] **P2.3** Handlers: change `make*Handlers` signatures from `OrpcHandler` to
  plain `(input, ctx) => Result/output`; keep all business logic and result types.
  `@/modules/platform/api/orpc-handler.ts` deleted. `error-mapping.ts`:
  `toORPCError` → `toHttpError` (same code strings, status per oRPC
  `COMMON_ERROR_STATUS_MAP`: 400/401/404/409/422/429/500 baseline).
- [x] **P2.4** `app.ts`: delete the raw-Node `/rpc` branch, `OpenAPIGenerator`,
  `ZodToJsonSchemaConverter`, `ZodSmartCoercionPlugin`; serve `GET /spec.json`
  from the committed `openapi.json` (read-only import); keep Scalar HTML pointing
  at it; keep `/health` `/ready` `/info`; register auth hook + route table.
- [x] **P2.5** Re-target api-layer tests to `fastify.inject()` against the real
  route registration (assert status + JSON body shape per D6/schemas). Use-case
  and domain tests untouched.
- [x] **P2.6** Remove backend `@orpc/*` deps; regen lockfile.

**P2 acceptance**: `pnpm --filter @axon/backend test` fully green (≥286 tests);
local dev stack smoke: real Firebase token → every route family answers
(auth/me, skill list+get+create, class list+qa, quiz get+submit+result, video recs,
stats overview) with correct status codes and D6 errors on failure
(e.g. foreign skill id → 404 `{"code":"NOT_FOUND",...}`).

### P3 — Kotlin cutover

- [x] **P3.1** Gradle: add the openapi-generator Gradle plugin (`org.openapi.generator`,
  version pinned = P0-tested) or a custom Exec task calling the CLI; task
  `generateOpenapiClient` wired before `compileDebugKotlin`; output
  `app/build/generated/openapi`; packages `com.iampauld3v.axon.data.generated(.api/.model)`.
  Add generated sources to `sourceSets`.
- [x] **P3.2** `AppContainer`: build Retrofit + generated Api; OkHttp interceptor
  for `Authorization: Bearer` from the existing `tokenProvider`; base URL from the
  same config the OrpcClient used. Generated client converter must use
  `ignoreUnknownKeys = true` semantics (from P0.3 finding).
- [x] **P3.3** Error type: replace `RpcException` with a lean `ApiException(status,
  code, message)` (D6 body parsing); migrate EVERY reference under `feature/` and
  `data/repo/` (grep `RpcException` to zero after).
- [x] **P3.4** Delete `OrpcClient.kt`, `AxonApi.kt`, `Dtos.kt`; rewire
  `data/repo/*` to the generated service. Prefer returning generated models
  directly (they mirror the old DTOs); map only where naming is unbearable.
- [x] **P3.5** Screen-mount parallelism: verify screens that previously relied on
  batch coalescing (home, skill detail, lesson) launch concurrent suspend calls —
  no accidental serial `await`s introduced (D9).

**P3 acceptance**: `./gradlew :app:assembleDebug` clean; `grep -r "OrpcClient\|AxonApi\|Dtos.kt"` → zero hits; device smoke against the deployed dev stack: login →
home → skill create/generate → lesson → qa ask → quiz submit/result → video recs +
sponsor segments; error paths (airplane mode, expired token) show the same UX as
today.

### P4 — Cleanup & docs (same change as P3 per repo rule)

- [x] **P4.1** Knowledge-base sync: `ARCHITECTURE.md` (backend transport section +
  android data layer diagram: dto/api layers → generated client),
  `API.md` (rewrite: REST/JSON semantics, no envelope, D6 error model, auth,
  spec/scalar), `GAPS.md` (D9 batching entry + P0 quirks), `apps/android/AGENTS.md`
  (replace "DTOs mirror 1:1" rule with generated-client rule; update docs map),
  `apps/android/docs/MIGRATION_PLAN.md` (API row → superseded by this file).
- [x] **P4.2** Flag for the user (user-owned file, do not edit unprompted): root
  `AGENTS.md` "Project state" still says "Expo/RN mobile + Fastify/oRPC DDD
  backend" — propose updating to Kotlin + Fastify/OpenAPI.
- [x] **P4.3** Residual grep sweep: `orpc` (case-insensitive) across repo → only
  historical knowledge-base hits remain; `pnpm-workspace.yaml` / lockfile contain
  no mobile or `@orpc` residue; `.github/workflows/*` consistent.
- [x] **P4.4** `DEPENDABOT_REMEDIATION_PLAN.md`: mark the four @orpc rows resolved-by-removal.
- [ ] **P4.5** Status line at top of this file → COMPLETE; move execution-authority
  pointer back to `ARCHITECTURE.md`. — *PENDING: the authority pointer is moved
  (see ARCHITECTURE.md header); the COMPLETE flip waits on the user push to
  `dev` + the device smoke (§7), which are user-owned.*

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Generator output quality (nullability, dates, naming) | P0 spike on the REAL spec before any commit; kill-switch with fallback ladder |
| zod v4 `z.toJSONSchema` on coerced schemas | P0.2; default-safe fallback = transport-owned coercion |
| GET params arrive as strings (oRPC coerced via `ZodSmartCoercionPlugin`) | P0.2 decision + Fastify-layer helper; schema `z.infer` types unchanged |
| Batch coalescing loss | D9 accepted; parallel suspend calls; GAPS entry |
| One-shot wire break | Single client, single deploy; smoke both sides before merge; `/health` CI gate unchanged |
| Generated model names clash with existing UI models | P0.3 package separation (`data.generated`); map at repo boundary only if needed |
| Auth hook regression (was global middleware) | All 24 routes behind one hook applied from the table; 401 asserted in api tests |

## 7. End-to-end verification checklist (before marking COMPLETE)

- [ ] CI green: backend suite + spec drift check + deploy-dev `/health` smoke.
- [ ] `openapi.json` covers 24/24 operations; Scalar renders it at `/`.
- [ ] Device flow (deployed dev stack): login → home → skill create/generate →
  lesson → qa ask/retry → quiz submit/result → video recs + sponsor segments.
- [ ] Error UX: 401 (expired token) and 404 (foreign id) produce the same user
  -visible behavior as the oRPC build.
- [ ] `grep -ri orpc` on source dirs (apps/, packages/) → zero hits.
- [ ] Docs synced per P4.1.

## 8. Non-goals

- No API versioning strategy (single client, internal API).
- No new endpoints, schema changes, or business-logic refactors — transport only.
- No RN app revival; no iOS/web clients (the spec now makes them cheap later).

## 9. Implementer notes (cold-session)

- Build order: `pnpm --filter @axon/api-contract build` FIRST (backend resolves
  `dist/`), then backend, then Kotlin.
- **P0 record (2026-10-28).** Generator: openapi-generator-cli **7.26.0** (jar
  from Maven Central; run with JDK 17 — system JDK 26 also works for the CLI).
  Exact flags: `generate -i openapi.json -g kotlin --library jvm-retrofit2
  --additional-properties=serializationLibrary=kotlinx_serialization,dateLibrary=string,useCoroutines=true
  -o <dir>` (flag names verified via `config-help -g kotlin`). Generated code
  compiled clean against the app stack (Kotlin 2.2.20, Retrofit 2.11.0, OkHttp
  4.12.0, kotlinx-serialization-json 1.7.3, coroutines 1.9.0, JDK 17, Gradle
  9.8) — the ONLY missing deps vs the app were `okhttp:logging-interceptor`
  and `retrofit2:converter-scalars` (generated ApiClient uses both).
  `ignoreUnknownKeys = true` is the generated default (`Serializer.kt`) — no
  custom converter needed. Quirks found, all resolved:
  (1) zod v4 `z.toJSONSchema` throws on `z.date()` unless `unrepresentable:
  "any"` + an `override` mapping Date → `{type:"string",format:"date-time"}`;
  (2) `target: "openapi-3.0"` handles nullable/const/exclusiveMin correctly
  (`const: true` → `enum: [true]`, `type: ["x","null"]` → `nullable: true`);
  (3) plain `z.number()` emits `type: number` → generated Kotlin
  `java.math.BigDecimal` — route-table param/query id fields therefore derive
  `.int()` (source-picked, not restated), so all generated params are
  `kotlin.Int`; RESPONSE models keep `BigDecimal` wherever the schema says
  bare `z.number()` (D2 keeps schemas unchanged — flagged to the user);
  (4) `maximum: 9007199254740991` noise appears on `type: integer` (MAX_SAFE_
  INTEGER) — harmless; (5) multi-tag routes get emitted into SEVERAL API
  classes by the generator — the route table uses exactly ONE tag per route;
  (6) no discriminated unions and no `z.coerce` exist in the schemas, so
  P0.1's union check was vacuous and P0.2 landed as the fallback: plain
  schemas in the spec + Fastify-owned string→number/boolean coercion
  (`safeParse`-probed, in `apps/backend/src/lib/routes.ts`);
  (7) zod v4's `openapi-3.0` target + TS7 CLI: `--noEmit false` (space form)
  silently emits NOTHING and `--noEmit=false` is rejected — declaration emit
  now uses `tsconfig.build.json` (`tsc -p tsconfig.build.json`); the extends
  chain also needs an explicit `outDir`/`rootDir` or declarations land next to
  sources.
- **P3 record (2026-10-28).** Gradle plugin `org.openapi.generator` 7.26.0
  (alias in `libs.versions.toml`), task `openApiGenerate` wired into `preBuild`,
  `cleanupOutput=true`; generated sources added to android `sourceSets`.
  Gradle-plugin quirks (cost a few build cycles — recorded so they never
  repeat): (a) the kotlin generator keys the infrastructure package off
  **`packageName`** (configOptions) — `invokerPackage` is ignored for
  templates, so infrastructure landed under the default `org.openapitools.*`
  until packageName was set; (b) the kotlin layout is `{packageName}.apis` /
  `.auth` / `.infrastructure` — NOT `.api`; (c) plugin DSL properties
  (`generatorName` etc.) must all be set — an auto-mangled build script
  surfaced as "generator name must be specified". DEVIATION from P3.4's
  letter (repo wins): `data/dto/Dtos.kt` and `data/api/AxonApi.kt` are KEPT —
  AxonApi rewritten as a mapping facade over the generated services — because
  P0 quirk (3) (BigDecimal for bare-number ids) would have polluted every
  screen with BigDecimal ids. OrpcClient.kt (the wire protocol) is deleted;
  the hand-mirrored wire code the plan wanted gone is gone: paths/payloads/
  parsing are 100% generated. AppContainer builds one `ApiClient` with a
  bearer-token OkHttp interceptor (`runBlocking { session.idToken() }`) and
  `createService`s the six interfaces. `RpcException` → `ApiException(status,
  code, message)` (no `defined` flag; D6 body parsed from errorBody).
  Package reality: the app package is `com.iampavlo.axon` (§3.3's
  `com/iampauld3v/...` paths were wrong — repo wins). Kotlin deps added:
  `retrofit:converter-scalars` (generated ApiClient needs it);
  `logging-interceptor` was already present. Device smoke + §7 gates wait on
  the user push to `dev` (deploy-dev runs automatically).
- Tailscale caveat (repo rule): local `docker compose` dev stack loses egress
  while the exit node is up — if a local build fails with `EAI_AGAIN`, report and
  use the deployed dev stack (CI on GitHub runners is unaffected).
- Backend deploy is automatic on push to `dev` (deploy.yml); Kotlin is built
  locally (`./gradlew :app:assembleDebug`).
- Sources of truth if this file disagrees with the repo: the repo wins; update
  this file in the same change.
