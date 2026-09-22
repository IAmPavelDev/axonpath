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

## Project state (actualized 2026-09-22)
- Axon = adaptive AI-learning app: Expo/RN mobile + Fastify/oRPC DDD backend +
  `@axon/api-contract` (pnpm monorepo). **Beta is DONE** — Phases 1–6 + Firebase auth;
  backend 86/86 tests and mobile `tsc --noEmit` verified green 2026-09-22 at `d6508e8`.
- Current phase: **Phase 7 (post-beta)** — execution authority
  `knowledge-base/PHASE7_POST_BETA.md`. Current-state detail: `knowledge-base/ARCHITECTURE.md`;
  plan history: `knowledge-base/BETA_PLAN.md`; gap ledger: `knowledge-base/GAPS.md`.
- Commands: build `@axon/api-contract` FIRST (backend resolves `dist/`);
  `pnpm --filter @axon/backend test`; `pnpm --filter @axon/mobile exec tsc --noEmit`
  (package name is `@axon/mobile`, not `axon-mobile`); dev stack
  `docker compose -f docker-compose-dev.yaml up -d`.
- TypeScript 7.0.2 upgrade is committed (`d974bd2`; ts-node dropped, api-contract build
  emits `.d.ts`). Durable next-class job queue + sweeper landed in `5902e68`/`d6508e8`.
  Working tree is clean.
- Deployment (beta): AWS free tier (t3.micro + swap, ≤5 users), static Elastic IP,
  HTTPS via self-signed CA (Caddy :443; APK bundles the CA) — runbook
  `knowledge-base/DEPLOY_AWS_BETA.md`. Image is BUILT ON THE DEV MACHINE
  (`pnpm backend:image`) and shipped via docker save/load — **never `--build` on the
  server** (1 GiB RAM OOMs). Certs: `./deploy/generate-certs.sh <IP>`. Stack
  `docker-compose-prod.yaml` + `.env.aws`; Android beta via EAS (`apps/mobile/eas.json`).
- Docs rule: landing a phase includes syncing ARCHITECTURE/GAPS/BETA_PLAN status lines
  and ticking the phase file's steps in the same change.
