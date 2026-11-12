# Axon

AI-powered adaptive learning app: a native Android client backed by a serverless Fastify REST API on AWS.

## Architecture

pnpm monorepo with three packages:

| Package | What it is |
|---|---|
| `apps/android` | Native Android app — Kotlin, Jetpack Compose |
| `apps/backend` | Fastify REST API (declarative route table + Zod schemas), DDD-style, Prisma/Postgres, Qdrant vector search |
| `packages/api-contract` | Shared Zod schemas + OpenAPI emission — single source of truth for the API surface |

Production runs serverless: API Gateway → Lambda (`axon-api`, 30 s) for requests, a worker Lambda (`axon-worker`, EventBridge `rate(1 minute)`) for background jobs (durable Postgres-backed queue), RDS Postgres, Qdrant Cloud for embeddings.

## Development

Prerequisites: Node 20+, pnpm 10, Docker, JDK/Android SDK for the app.

```bash
# 1. Install
pnpm install

# 2. Build the shared API contract first (backend resolves dist/)
pnpm --filter @axon/api-contract build

# 3. Start dev stack (Postgres, RabbitMQ, etc.)
docker compose -f docker-compose-dev.yaml up -d

# 4. Run backend tests
pnpm --filter @axon/backend test

# Or run the backend directly with watch
pnpm --filter @axon/backend dev:watch
```

Android app: open `apps/android` in Android Studio (or `./gradlew assembleDebug`).

## Deployment

One Docker image serves both Lambda functions:

```bash
pnpm backend:image:lambda        # build the lambda-target image
docker push <ecr-repo>           # push to ECR
bash scripts/provision-serverless.sh   # idempotent infra setup (eu-central-1)
```

`docker-compose-prod.yaml` remains as a self-hosted fallback.

## Documentation

- `knowledge-base/ARCHITECTURE.md` — current-state architecture
- `knowledge-base/DEPLOY_AWS_SERVERLESS.md` — deployment runbook
- `knowledge-base/GAPS.md` — known gaps / debt ledger
- `apps/android/ARCHITECTURE.md` — app architecture
