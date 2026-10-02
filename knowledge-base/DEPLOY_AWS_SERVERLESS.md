# Axon — Serverless deployment (Lambda + API Gateway + Neon + Qdrant Cloud)

> Written 2026-10-02. **Execution authority for the serverless cutover** — the
> replacement for `DEPLOY_AWS_BETA.md` (EC2 t2.micro), which stays valid until
> the cutover completes and the EC2 instance is terminated.
>
> Cost decision (2026-10-02): the AWS account was created 2024-05-05, so the
> classic 12-month free tier expired 2025-05-05 and the post-2025-07 credits
> plan does not apply. **RDS would cost ~$11–13/mo forever** — the DB runs on
> **Neon's free tier** instead, and vectors on **Qdrant Cloud's free cluster**
> (the beta's own Qdrant container, migrated 1:1). Lambda (1M req + 400k GB-s)
> and SQS are always-free; API Gateway and ECR bill cents at this traffic.
> Expected total: **~$0.10–0.60/mo** (ECR over the 500 MB allowance + API GW
> per-request).

## Architecture

| Concern | Service | Notes |
|---|---|---|
| API | Lambda `axon-api` (30 s cap) + API Gateway HTTP API (payload 1.0) | `serverless-http` wraps the shared raw handler (`src/app.ts`); Fastify's router serves `/health` `/ready` `/info`; oRPC handles `/rpc/*` before Fastify |
| Jobs | Lambda `axon-worker` (15 min cap), EventBridge Scheduler `rate(1 minute)` | One sweep per tick: next-class reconcile + claim + generation **awaited inline**, class-qa stranded requeue, then `jobQueueIdle()` drains every setImmediate job incl. follow-ups |
| Postgres | Neon free plan, **pooled** endpoint | Durable job queues (`FOR UPDATE SKIP LOCKED`) unchanged; migrations run from the dev machine — no migrate step in Lambda |
| Vectors | Qdrant Cloud free cluster | Same collection shape (3072-dim cosine + userId/skillId indexes) via `qdrant-migrate.mts` |
| Auth | Firebase (unchanged) | JWKS fetch needs public egress — the reason there is **no VPC and no NAT Gateway** (NAT alone would be ~$33/mo) |

In-process `setImmediate` jobs the API Lambda starts are expected to die at
invocation freeze: durable rows + the worker's next tick recover them
(≤1 min for next-class, ≤2 min staleness window for class-qa answers). Claims
and leases make replays safe; the design explicitly tolerates lost in-process
jobs (see `next-class-job.repository.ts`).

## 1. One-time setup (user)

1. Install the AWS CLI and configure credentials:
   `sudo pacman -S aws-cli && aws configure` (keys from IAM console).
2. Create a **Neon** project (neon.tech, free plan) → copy the **pooled**
   connection string → `DATABASE_URL`.
3. Create a **Qdrant Cloud** free cluster → API key → `QDRANT_URL` + `QDRANT_API_KEY`.
4. Fill `.env.aws.serverless` (template: `.env.aws.serverless.example`).

## 2. Provision (scripted)

```sh
AWS_REGION=<region> ALERT_EMAIL=<you> bash scripts/provision-serverless.sh
```

Creates ECR repo `axon-backend`, roles `axon-lambda-role` / `axon-scheduler-role`,
functions `axon-api` (30 s) + `axon-worker` (15 min), HTTP API `axon-http`
(payload 1.0 — quick-create's 2.0 breaks serverless-http), schedule
`axon-worker-tick`, $1 billing alarm (us-east-1; confirm the SNS email).
Idempotent: re-runs update functions in place.

## 3. Build & push the image (every deploy)

```sh
pnpm backend:image:lambda
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker tag axon-backend:lambda <account>.dkr.ecr.<region>.amazonaws.com/axon-backend:lambda
docker push <account>.dkr.ecr.<region>.amazonaws.com/axon-backend:lambda
bash scripts/provision-serverless.sh   # re-run: updates both functions
```

## 4. Data migration (during cutover window)

```sh
# Postgres: schema first (from the dev machine — Neon is public, no bastion),
# then a data-only dump from the EC2 instance. migrate deploy before restore
# keeps DDL under Prisma's control; the data-only dump avoids any PG18 DDL
# drift against Neon.
cd apps/backend
set -a; . ../../.env.aws.serverless; set +a   # quotes in the file matter
pnpm exec prisma migrate deploy --schema ./src/prisma/schema.prisma

ssh -i ~/Downloads/axon-beta.pem ubuntu@<EC2-IP> \
  'docker exec axon-db pg_dump -U axon -d axon --data-only' > backup-pre-serverless.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f backup-pre-serverless.sql

# Vectors: EC2 qdrant is container-network-only → SSH-tunnel its container IP,
# then migrate with a count check (148/148 at cutover).
QDRANT_CONTAINER_IP=$(ssh -i ~/Downloads/axon-beta.pem ubuntu@<EC2-IP> \
  'docker inspect axon-qdrant -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"')
ssh -i ~/Downloads/axon-beta.pem -f -N -L 16333:$QDRANT_CONTAINER_IP:6333 ubuntu@<EC2-IP>
SOURCE_QDRANT_URL=http://localhost:16333 \
TARGET_QDRANT_URL=$QDRANT_URL TARGET_QDRANT_API_KEY=$QDRANT_API_KEY \
  pnpm exec tsx --require tsconfig-paths/register qdrant-migrate.mts
```

```sh
curl https://<api-id>.execute-api.<region>.amazonaws.com/health          # → 200 {"status":"ok",...}
curl https://<api-id>.../rpc/auth/me                                     # → 401 tagged error
```

## 5. Cutover

1. `apps/mobile/eas.json`: `EXPO_PUBLIC_API_URL` → the API Gateway URL
   (HTTPS — the Android cleartext allowance becomes dead weight).
2. `eas build --profile preview` (Android APK), distribute, verify on device.
3. **Terminate the EC2 instance** (user action, explicit confirmation): the
   t2.micro + 25 GiB gp3 is the ~$9–10/mo bleed. Dump a final backup first.
4. Sync status lines in `ARCHITECTURE.md` / `GAPS.md` and retire the beta
   runbook (keep as history).

## Known tradeoffs

- **QA answer latency**: on EC2 answers were instant (in-process); on Lambda
  they ride the worker tick — worst case ~2 min (stale-claim window), typical
  ≤1 min. Class generation unchanged (durable row, worker-inline).
- **API 30 s cap**: inline LLM RPCs (e.g. `qa.ask`) must fit; generation
  already runs via durable jobs, so it is unaffected.
- **Cold starts**: Prisma engine + Fastify boot ≈ 1–3 s per cold container;
  irrelevant at ≤5 users.
- **ECR storage**: image > 500 MB always-free allowance → ~$0.10/GB-mo.
