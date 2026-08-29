# Axon — Knowledge Base

Human- and AI-readable docs describing what Axon **is** (concept), how it's **built** (code), what
is **missing** (gaps), and how to get it to **beta** (roadmap). Every file is plain Markdown with
mermaid diagrams so both humans and agents can orient quickly.

## Reading order for newcomers

```
CONCEPT.md      → the idea, vocabulary, and product vision (start here)
ARCHITECTURE.md → how the code is actually laid out today, with diagrams
API.md          → the exact RPC surface (contract-first)
GAPS.md         → what's missing between here and a workable beta
ROADMAP.md      → the 3–4 week sequenced plan to beta
```

## File map

| File | Answers | Audience |
|---|---|---|
| **CONCEPT.md** | What the product wants to be; the core adaptive loop; the "memory" idea; domain vocabulary | humans + agents framing work |
| **ARCHITECTURE.md** | Code as it stands: monorepo, backend, data model (ER), mobile, infra; what is real vs stub | humans + agents touching code |
| **API.md** | Contract-first RPC surface; the *_UNWIRED_* / implemented coverage table; how to add an endpoint | humans + agents building features |
| **GAPS.md** | Every gap (blocker/high/medium/low) with evidence + acceptance criteria | planning, scoping |
| **ROADMAP.md** | Sequenced 4-week plan, decisions, risks, first concrete step | execution |

## Status

- Monorepo: pnpm workspaces (`apps/backend`, `apps/mobile`, `packages/api-contract`).
- Backend: Fastify + oRPC (contract-first) + Prisma + Postgres/**pgvector** + Gemini.
- Mobile: Expo / React Native (expo-router, NativeWind, TanStack Query, Zustand).
- **Current reality:** a read→quiz happy path works in dev against one hard-coded user; the
  adaptive next-class loop and vector *retrieval* are not yet wired (see GAPS.md #1/#2).
- **Target:** workable beta in **3–4 weeks** (ROADMAP.md).

## Conventions for AI agents

- To add an endpoint follow the pattern in API.md §9; the shareable contract is the source of
  truth. Keep vocabulary consistent with CONCEPT.md §3.
- Diagrams are `mermaid` blocks — keep them accurate when you change code; update the matching doc
  (GAPS/ARCHITECTURE/API) in the same change.

## Getting started (dev)

1. `pnpm install` (pnpm 10; workspaces: `apps/backend`, `apps/mobile`, `packages/api-contract`).
2. Root `.env` (no `.env.example` exists yet — see GAPS #15): `DATABASE_URL` (Postgres+pgvector),
   `GEMINI_API_KEY`, `APP_PORT`, `NODE_ENV`. Compose maps the backend on **3001**.
3. Build the shared contract **before** starting the backend — the backend resolves
   `@axon/api-contract` from its `dist/`: `pnpm --filter @axon/api-contract build`.
4. Boot the stack: `docker compose -f docker-compose-dev.yaml up -d`
   (backend auto-runs `prisma migrate deploy` + `prisma generate` + `dev:watch`).
   DB-only alternative: `pnpm --filter @axon/backend dev-db`.
5. Verify: `http://localhost:3001/health`, `/spec.json`, and `/` (Scalar docs).

Full env/config details: ARCHITECTURE.md §7–8.