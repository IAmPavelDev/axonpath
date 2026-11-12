# Local-Stack Migration — Decision Log

Chronological record of what was chosen, rejected, and why. Newest last.

## 2026-11-05 — AWS is unrecoverable for now
- Old AWS account **suspended** (billing); IAM key revoked, APIGW 404s. Verified
  via console banner.
- New-account-under-same-card rejected: signup fraud-throttled (error 83740 on
  +84 and +380 numbers) and cross-link suspension is near-certain. **Do not
  retry AWS signup with this card.**

## 2026-11-05 — Hosting target: dev PC + ngrok tunnel
Evaluated: AWS arrears (~$47), Oracle free tier (signup fraud-walled, abandoned
after repeated 83740-equivalent rejections), Hetzner (€4.05/mo), Railway
($5–10/mo), home machine in Ukraine (uptime risk), dev PC + ngrok ($0).
Owner chose **dev PC + ngrok**: $0, phone needs no Tailscale (it doesn't have
any), ngrok free tier provides one static domain for a stable APK URL.
Tailscale was rejected for the phone path (not installed; agent is forbidden
from touching Tailscale on the PC by standing directive).

## 2026-11-06 — Worker topology: RabbitMQ broker (owner overruled recommendation)
- Agent recommendation was 3 containers with in-process sweepers (EC2-beta
  parity, zero code change) and a Postgres-queue worker split (4 containers, no
  code change) if separation was wanted.
- **Owner decision: RabbitMQ + separate worker container (5 containers).**
  Accepted trade-offs, by design:
  - New transport adapter `rabbitmq-jobs.ts` implementing the existing
    `JobQueuePort` (the port doc always anticipated a broker). Use cases,
    sweepers, and the handler registry are untouched.
  - API process: enqueues + runs the 6 sweeper intervals (reconciliation net,
    at-least-once). Worker container: pure RabbitMQ consumer (`worker.ts`),
    prefetch 1, retries with `x-attempts`, dead-letter after 3 → `axon.jobs.dlq`.
  - Handlers remain idempotent (unchanged contract from the Lambda era).
  - Lambda behavior unchanged: default transport stays `memory`
    (`JOB_QUEUE_TRANSPORT=rabbit` only in compose).

## Rejected alternatives (kept for the record)
- **RabbitMQ everywhere / replacing Postgres job rows**: sweepers keep their
  durable-DB reconciliation because broker messages + DB state can diverge;
  DB scan re-enqueue is the recovery net. Not "Rabbit replaces Postgres".
- **ngrok without static domain**: URL rotates on restart → APK breaks.
  Static domain (owner claims it in dashboard) is mandatory.
- **systemctl stop nsfw-guard**: fail-closed design ⇒ network dark + watchdog
  restart. Removal only via the passphrase-gated binary (owner action).
