# Local-Stack Runbook — day-2 operations

## Tunnel

```bash
# The static domain is bound to one specific ngrok account — the tunnel MUST
# run with THAT account's authtoken (ERR_NGROK_320 "reserved for another
# account" means the wrong authtoken; the local ~/.config/ngrok/ngrok.yml
# holds a different account's token).
ngrok http --authtoken=<domain-account-token> \
  --url=https://election-retired-opposite.ngrok-free.dev 3001
```

Running agent-side as the supervised service `ngrok-tunnel` (inspect:
`proc://ngrok-tunnel`, local inspector UI at http://127.0.0.1:4040 while it
runs). ngrok free-tier interstitial warning page only affects interactive
browser navigations — API calls from the app are unaffected.

## Daily use

```bash
# Start everything (5 containers: rabbitmq, db, qdrant, backend, worker)
docker compose --env-file .env.aws -f docker-compose-prod.yaml up -d

# Tunnel (separate terminal or service; URL must be the reserved static domain)
ngrok http --url=<your-domain>.ngrok-free.app 3001

# Health
curl -s http://localhost:3001/health
curl -s https://<your-domain>.ngrok-free.app/health
```

## Inspecting the queue

```bash
docker exec axon-rabbitmq rabbitmqctl list_queues name messages messages_ready messages_unacknowledged
# DLQ depth (poison jobs):
docker exec axon-rabbitmq rabbitmqctl list_queues name messages | grep dlq
```

Dead-lettered jobs are visible in `axon.jobs.dlq`. Re-drive one manually by
re-publishing to `axon.jobs` (attempts header reset) — only after fixing the
root cause.

## Logs

```bash
docker logs -f axon-backend   # API + sweeper reconciliation
docker logs -f axon-worker    # RabbitMQ consumer / generation
```

## Rebuilding the image after backend code changes

```bash
docker compose --env-file .env.aws -f docker-compose-prod.yaml build backend
docker compose --env-file .env.aws -f docker-compose-prod.yaml up -d backend worker
```

## Rebuilding the APK after an API-URL change

1. `apps/android/app/build.gradle.kts` → `API_URL` buildConfigField.
2. `cd apps/android && ./gradlew assembleRelease`
   (keystore `axon_key.jks`, committed).
3. Install `app/build/outputs/apk/release/app-release.apk` on the phone.

## Backup (optional; data is low-value by decision)

```bash
mkdir -p ~/axon-backups
docker exec axon-db pg_dump -U axon axon | gzip > ~/axon-backups/axon-$(date +%F).sql.gz
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED amqp://rabbitmq:5672` in logs | broker not up yet | `docker compose ps` — wait for healthy; restart backend/worker |
| Worker exits with "Worker requires JOB_QUEUE_TRANSPORT=rabbit" | env missing on worker service | check compose `environment:` block |
| Generation stuck PENDING, worker logs silent | message stuck unacked or DLQ'd | `rabbitmqctl list_queues`; check `axon.jobs.dlq` |
| z.ai code 1113 | provider balance empty | top up z.ai account (embeddings unaffected) |
| **`gemini HTTP 429` with `quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier`** | the `gemini-flash-latest` ALIAS resolved to a model whose free tier is **20 requests/DAY** (e.g. gemini-3.8-flash) — the clips pipeline burns that in one class | `GEMINI_VIDEO_MODEL` in `.env.aws` pins a model with a real allowance (currently `gemini-3.5-flash-lite`, verified: YouTube `file_data` ingestion works). Check quotas at aistudio.google.com; the alias tracks Google's newest flagship — re-check after Google ships new versions |
| `EAI_AGAIN` in backend outbound calls | nsfw-guard MITM or exit-node DNS quirk | whitelist failing domain in `/etc/nsfw-guard/allow-custom.txt` + restart guard; confirm exit-node state |
| Tunnel 502/ERR_NGROK | backend container down | `docker compose ps`; backend healthcheck restarts it |
| PC rebooted | nothing auto-recovers? | compose `restart: unless-stopped` + re-run ngrok tunnel; verify /health |

## Environment files

- `.env.aws` — local stack secrets (Postgres, Firebase, z.ai, Gemini). chmod 600.
- `.env.aws.serverless.eu` — legacy AWS secrets, kept only as reference until
  the AWS account question is settled; the local stack does NOT read it.
