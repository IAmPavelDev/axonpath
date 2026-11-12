# Local-Stack Migration — Comprehensive Plan

**Created:** 2026-11-06 · **Status:** IN PROGRESS · **Owner:** @iampavlo

## 1. Why

The AWS account (`axonpath` production, eu-central-1) was **suspended** (billing).
Consequences, all verified 2026-11-05/06:

- IAM deploy key revoked → all CLI calls fail (`InvalidClientTokenId`).
- APIGW serves `404 {"message":"Not Found"}` on every route (suspension
  disables integrations) → the installed APK shows "Not Found" on Home.
- Reactivation requires paying the suspended balance (~$47/mo run rate,
  NAT-Gateway dominated). Owner declines: no budget, **no valuable data**
  (fresh DB is acceptable; skills/lessons regenerate on demand).
- A new AWS account under the same card is not viable: signup is fraud-throttled
  (error 83740 on +84 AND +380 numbers) and would be cross-link suspended anyway.

**Goal:** run the entire backend on the dev PC (Vietnam), expose the API to the
phone via a public tunnel (ngrok free static domain), total cost **$0**.

## 2. Current-state analysis

### What the code already supports
- `docker-compose-prod.yaml` = complete self-hosted stack (EC2-beta era):
  `db` (postgres:18) + `qdrant` (v1.19.1) + `backend` (`axon-backend:local`,
  Dockerfile `production` target, runs `prisma migrate deploy` on boot).
- `main.ts` (server mode) starts **all six sweepers in-process** after listen:
  next-class, class-qa, skill-init, grading, recommendations, class-clips.
  → **backend container alone covers worker duties; no separate worker
  container is required.** This is exactly how the EC2 beta ran.
- Durable job queue lives in Postgres (`modules/jobs`: claims, stale-claim
  recovery, sweeper reconciliation). No broker needed.
- Firebase auth is AWS-independent: the APK authenticates against Firebase
  (`axon-9e88e`); the backend only needs `FIREBASE_PROJECT_ID` to verify tokens.
- Qdrant runs **inside the compose** (`http://qdrant:6333`) — Qdrant Cloud is
  not needed at all.

### What already exists on the dev PC (verified)
| Asset | State |
|---|---|
| Docker 29.7.2 + Compose 5.4.0 | installed |
| `axon-backend:local` image | present but **5 weeks stale** (predates OpenAPI cutover `3a3dcab` + Ask-AI wire fix `173c942`) → rebuilt |
| `postgres:18`, `qdrant/qdrant:v1.19.1` | cached locally |
| ngrok + authtoken config | installed |
| APK signing keystore | `apps/android/axon_key.jks` (committed) |
| Gradle toolchain | working (2026-11-03 build) |

### Secrets
`.env.aws` (chmod 600) generated from `.env.aws.example`:
random `POSTGRES_PASSWORD`, `DATABASE_URL` → `db:5432`,
`QDRANT_URL=http://qdrant:6333`, plus `FIREBASE_PROJECT_ID` / `ZAI_API_KEY` /
`GEMINI_API_KEY` carried over from `.env.aws.serverless.eu`. All 14 vars set.

## 3. Target architecture (final: RabbitMQ split, 5 containers)

```
Phone (APK)
   │ HTTPS
   ▼
ngrok tunnel ──► backend :3001 ──► db (postgres:18)     5 containers on dev PC
   (static domain)  │ sweepers   qdrant :6333           docker compose
                    │ enqueue
                    ▼
               rabbitmq :5672 ──► worker (axon-worker) — consumes axon.jobs
                    └ dead-letter after 3 attempts → axon.jobs.dlq
   backend/worker outbound: z.ai (generation), Gemini (embeddings)
```

- `backend` = API + 6 sweeper intervals (reconciliation, at-least-once re-enqueue).
- `worker` = RabbitMQ consumer (`apps/backend/src/worker.ts`), same image,
  prefetch 1, retries via `x-attempts` header, DLQ after 3.
- Transport switch: `JOB_QUEUE_TRANSPORT=rabbit` in compose; default `memory`
  keeps dev/Lambda behavior untouched. Use cases and sweepers unchanged — only
  the adapter layer is new (`modules/platform/infrastructure/rabbitmq-jobs.ts`).
- Postgres/Qdrant/RabbitMQ stay internal to the compose network — never published.

## 4. Migration steps

| # | Step | State | Acceptance |
|---|---|---|---|
| 1 | `.env.aws` generated | ✅ done | 14 vars, chmod 600 |
| 2 | RabbitMQ adapter + worker entry (`rabbitmq-jobs.ts`, `worker.ts`), compose 5-container topology | ✅ done | 362/362 backend tests, `tsc --noEmit` clean |
| 3 | Rebuild `axon-backend:local` from current `dev` HEAD | ✅ done | fresh build incl. RabbitMQ adapter |
| 4 | `docker compose --env-file .env.aws -f docker-compose-prod.yaml up -d` | ✅ done | 5/5 containers healthy |
| 5 | Smoke API locally | ✅ done | `/health` 200; `/skill/list` no token → 401; worker consuming `axon.jobs` (1 consumer), DLQ declared |
| 6 | Reserve ngrok static domain | ✅ done | `election-retired-opposite.ngrok-free.dev` |
| 7 | Start tunnel (persistent service `ngrok-tunnel`) | ✅ done | WAN `/health` 200, `/skill/list` 401 through `https://election-retired-opposite.ngrok-free.dev` |
| 8 | Point APK at tunnel: `apps/android/app/build.gradle.kts` `API_URL` → `https://election-retired-opposite.ngrok-free.dev` | ✅ done | gradle build clean |
| 9 | Build release APK (`./gradlew assembleRelease`, committed keystore) | ✅ done | `apps/android/app/build/outputs/apk/release/app-release.apk` (36 MB, 2026-11-06 11:53) |
| 10 | Install on phone, sign in, create a skill | ⏳ owner | generation completes end-to-end (exercises Rabbit→worker→z.ai) |
| 11 | KB sync: tick this file, update `ARCHITECTURE.md`/`GAPS.md` status lines | ⏳ | docs rule honored |

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| PC sleeps / powers off | API unreachable for the phone | disable suspend while on AC; tunnel + compose `restart: unless-stopped` auto-recover on wake |
| ngrok free-tier URL rotation | APK breaks | reserved static domain (step 5); never run tunnel without `--url` |
| ngrok free bandwidth / connection limits | degraded streaming endpoints | acceptable for single user; class QA is request/response, no streaming |
| Docker Hub pulls from VN (no VPN) | build failures | all needed images now cached locally; future rebuilds only on code change |
| nsfw-guard (MITM proxy) intercepts backend outbound z.ai/Gemini/Firebase calls | generation breakage | guard CA is in system trust, so TLS works; if a call 403s, whitelist domain in `/etc/nsfw-guard/allow-custom.txt` |
| Vietnam ISP blocks ngrok edge | tunnel down | fallback: cloudflared tunnel (free static domain, CF edge usually reachable); see RUNBOOK |
| Laptop storage/db volume loss | data loss | user accepted: no valuable data; optional nightly `pg_dump` to `~/axon-backups` (RUNBOOK) |
| z.ai balance runs out (code 1113) | generation dies | unchanged from serverless era; top up or swap key |

## 6. Verification plan (before declaring done)

1. `docker compose ps` — 3/3 healthy.
2. `curl -s localhost:3001/health` → 200; unauthenticated `/skill/list` → 401.
3. `curl -s https://<domain>/health` from WAN (not via localhost) → 200.
4. Phone: sign in with Google → library loads (empty).
5. Phone: create skill → PENDING → ACTIVE with lessons (proves sweeper + z.ai
   + embeddings + Qdrant write path end-to-end).
6. Ask AI on a class → answer generated (proves class-qa sweeper path).
7. Restart `docker compose down && up -d` → /health returns, tunnel survives
   (or reconnects), no data loss.

## 7. Cost & rollback

- Cost: **$0** (ngrok free single static domain, all compute local). Variable:
  z.ai tokens (generation), unchanged from before.
- Rollback to AWS: pay the suspended account's arrears → AWS restores routes
  automatically (suspension, not deletion); APK URL revert is one gradle line.
  Data created locally would NOT move back automatically (fresh DB there too).
- Future (free-tier expires, budget appears): Hetzner CAX11 €4.05/mo runs the
  identical compose file unchanged — this migration is deliberately
  location-agnostic (one compose file + one tunnel command).
