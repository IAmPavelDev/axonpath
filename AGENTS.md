# Axon — agent rules

## Tailscale — FORBIDDEN TO TOUCH (user directive, 2026-09-21)
- NEVER run any `tailscale` command — not even read-only ones like
  `tailscale status` — and NEVER change Tailscale state (exit node, up/down,
  disconnect, DNS/proxy settings). Only the user does that.
- Tailscale and its exit node (`desktop-rl8m766`) must stay ON at all times.
  The user works in parallel through it; downtime blocks their work.
- Known, ACCEPTED side effect: with the exit node active, Docker containers
  lose outbound egress (policy rule 5270 routes everything via `tailscale0`;
  builds/pulls fail with `EAI_AGAIN`). This is expected — do NOT "fix" it by
  disabling the exit node. If `docker build`/`pull` fails this way: stop,
  report the blocker, and let the user decide (e.g. they pause the exit node
  themselves, or you fall back to cached/base images).

## Project state (actualized 2026-10-08)
- Axon = adaptive AI-learning app: Expo/RN mobile + Fastify/oRPC DDD backend +
  `@axon/api-contract` (pnpm monorepo). **Beta is DONE** — Phases 1–6 + Firebase auth.
  Backend 286/286 tests and mobile `tsc --noEmit` green as of 2026-10-02.
- Current phase: **serverless production** (Lambda cutover landed 2026-10-02, EC2
  terminated) — execution authority `knowledge-base/DEPLOY_AWS_SERVERLESS.md`.
  Current-state detail: `knowledge-base/ARCHITECTURE.md`; plan history:
  `knowledge-base/BETA_PLAN.md`; gap ledger: `knowledge-base/GAPS.md`.
- Commands: build `@axon/api-contract` FIRST (backend resolves `dist/`);
  `pnpm --filter @axon/backend test`; `pnpm --filter @axon/mobile exec tsc --noEmit`
  (package name is `@axon/mobile`, not `axon-mobile`); dev stack
  `docker compose -f docker-compose-dev.yaml up -d`.
- TypeScript 7.0.2 upgrade committed (`d974bd2`). Durable Postgres job queue +
  sweeper landed in `5902e68`/`d6508e8`; sweeper gained `tickOnce`/`awaitRuns` and the
  setImmediate queue an `idle()` drain for the Lambda worker (2026-10-02).
- Deployment (serverless, since 2026-10-02; **eu-central-1 since 2026-10-08** — the
  us-east-1→eu-central-1 move was a latency fix: RTT from EEST drops ~235→~60 ms;
  oRPC batch plugins cut screen-mount parallel queries to one HTTP round trip):
  Lambda `axon-api` (30 s) + `axon-worker`
  (15 min, EventBridge `rate(1 minute)`) behind API Gateway HTTPS
  (`https://t3afkc5pj2.execute-api.eu-central-1.amazonaws.com`, baked into the APK via
  `apps/mobile/eas.json`), Postgres on **Neon free** (pooled URL, project
  `ep-jolly-boat-b1hgyqni`), vectors on **Qdrant Cloud free** (new account — the old
  account's free tier allowed only one cluster). One image serves both functions:
  `pnpm backend:image:lambda` → push to
  ECR → `bash scripts/provision-serverless.sh` (idempotent, eu-central-1; run it
  before the first push in a new region — it creates the ECR repo — and it creates
  the `$default` stage the invoke URL needs). Secrets in
  `.env.aws.serverless.eu` (git-ignored; DATABASE_URL must stay quoted — the script
  sources the file with bash). `docker-compose-prod.yaml` remains for a self-hosted
  fallback only. Old EC2 beta (`DEPLOY_AWS_BETA.md`) terminated 2026-10-02 after its
  data and vectors were migrated. Known limit: API Gateway caps requests at 30 s;
  class-qa answers ride the worker tick (≤2 min). Watch: z.ai account balance
  (generation dies with code 1113 when it runs out; Gemini embeddings unaffected).
- Docs rule: landing a phase includes syncing ARCHITECTURE/GAPS/BETA_PLAN status lines
  and ticking the phase file's steps in the same change.
