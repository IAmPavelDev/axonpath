# Axon — AWS beta deployment (all-free: t2.micro, plain HTTP, ≤5 users)

> Written 2026-09-22; all-free edition: **no Elastic IP, no HTTPS, no domain** — the app
> talks plain HTTP straight to the instance's auto-assigned public IP
> (`http://<IP>:3001`, Android cleartext already enabled). **Execution authority for
> deploying the beta to AWS.** The user performs console steps (AWS, Firebase, Expo);
> everything scriptable is in the repo: `docker-compose-prod.yaml` (full stack),
> `.env.aws.example` (config template), `apps/mobile/eas.json` (Android beta build).
> Stack: Postgres + Qdrant + RabbitMQ + backend on one EC2 instance; the Docker image is
> **built on the dev machine and shipped** — the server never compiles.
> (The self-signed-HTTPS variant lives in git history if TLS is ever wanted.)

## 0. How AWS bills this — and what it costs

**EC2 charges per hour the machine EXISTS, never per request.** 5 users or 0 users, the
bill is the same fixed rent. Your load is irrelevant.

| Bill line | Rate | Your beta |
|---|---|---|
| t2.micro compute | ~$0.0104/h ≈ $7.6/mo running 24/7 | **$0** for 12 months (new accounts: 750 h/mo free — a full month) |
| Public IPv4 address | $0.005/h ≈ $3.65/mo | **$0** for 12 months (new accounts: 750 h/mo free) |
| Disk (EBS gp3) | ~$0.08/GB-mo | **$0** for 12 months (free tier covers 30 GiB; we use 25) |
| Requests / traffic in | **$0 — there is no per-request charge** | always $0 |
| Traffic out (egress) | 100 GB/mo free, then $0.09/GB | a few MB/day → effectively $0 |
| **Total** | | **$0/mo for the first 12 months; ≈$11/mo flat after** |

Caveats:
- The 12-month clock started when the AWS account was **created**. Older account ⇒ the
  same setup bills ≈$11/mo from day one (no AWS trick avoids that).
- The instance's public IP changes on **Stop → Start**. It's baked into the APK, so:
  **leave the instance running** (free tier covers 24/7 anyway). A reboot is fine — only
  Stop/Start changes the IP. If it ever changes: update `eas.json`, rebuild the APK.
- Set the **$0-budget billing alarm** (§2.6) so nothing ever surprises you.

| Decision | Choice | Why |
|---|---|---|
| Instance | **t2.micro** (1 vCPU, 1 GiB) + **2 GB swapfile** | Free tier; fits the new-account **vCPU quota of 1** exactly; enough for ≤5 users (runtime ≈600 MB resident; AI generation runs on z.ai/Google's servers, not here) |
| Image builds | **Dev machine** (`pnpm backend:image`), shipped via `docker save` → scp → `docker load` | Building peaks ~2 GB RAM — OOMs 1 GiB. **Never `--build` on the server** |
| No Elastic IP | Auto-assigned public IP, instance runs 24/7 | EIP saves nothing in year 1 (both free) and buys only stop/start stability; simplest free setup wins |
| No TLS | Plain HTTP :3001 | User decision — accepted: Firebase ID tokens (~1 h validity) + content cross the network unencrypted. Fine for a 5-person beta; the self-signed HTTPS variant is in git history when needed |
| RabbitMQ | Deployed per user decision | ~100 MB idle, unused — first thing to drop if RAM is tight |
| Android build | EAS cloud build (`preview` → APK) | EAS free plan; no local Android SDK |
| Firebase | Spark plan | Email/password auth free |

## 1. Prerequisites (one-time)

1. AWS account (younger than 12 months ⇒ everything here is $0).
2. `ZAI_API_KEY` (z.ai, chat) + `GEMINI_API_KEY` (Google AI Studio, embeddings) — same
   as local dev.
3. Firebase **Web app** config: console.firebase.google.com → project → ⚙ **Project
   settings → General → Your apps → Web app (`</>`) → Config** → copy `apiKey`,
   `authDomain`, `projectId`, `appId`. Check **Authentication → Sign-in method →
   Email/Password = Enabled**.
4. Expo account (free) — expo.dev.
5. Android phone (8+).

## 2. AWS console (~15 min)

**2.1 Create the instance:**

1. https://console.aws.amazon.com → top-bar region picker → pick a region near you
   (remember it).
2. Search `EC2` → left sidebar **Instances → Launch instances**.
3. Name: `axon-beta`.
4. **Application and OS Images**: **Ubuntu** → any current LTS (**24.04 or 26.04**),
   64-bit x86.
5. **Instance type**: **t2.micro** (1 vCPU, 1 GiB). New accounts default to a **vCPU
   quota of 1** — t3.micro (2 vCPUs) fails at launch with "requested more vCPU capacity
   than your current vCPU limit"; t2.micro fits exactly. (Want 2 vCPUs later? Service
   Quotas → EC2 → *Running On-Demand Standard (A,C,D,H,I,M,R,T,Z) instances* → request
   an increase.)
6. **Key pair (login)**: **Create new key pair** → name `axon-beta`, **Ed25519**, **.pem**
   → **Create key pair** → on your machine: `chmod 400 ~/Downloads/axon-beta.pem`
7. **Network settings → Edit**: create security group `axon-beta-sg` with **two inbound
   rules**:
   - **SSH** / 22 / source **My IP**
   - **Custom TCP** / port **3001** / source **Anywhere-IPv4**
8. **Configure storage**: **25 GiB** gp3.
9. **Launch instance** → wait for **Running** + **2/2 checks**.
10. Back on the Instances page: your instance has a **Public IPv4 address** (e.g.
    `54.10.20.30`) — **copy it into your notes; this is `<IP>`**, the value baked into
    the APK.

**2.2 Cost guardrail:** top-right account menu → **Billing and Cost Management →
Budgets → Create budget → Zero spend budget** → your email. Free, warns if anything
ever bills.

✓ Gate: `ssh -i ~/Downloads/axon-beta.pem ubuntu@<IP>` shows the Ubuntu greeting.

## 3. Server bootstrap (5 min, one time)

SSH in, paste:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2

# Mandatory on 1 GiB RAM: 2 GB swap so services never OOM
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

sudo usermod -aG docker ubuntu && sudo systemctl enable --now docker
exit
```

SSH back in (exit applied the docker group):

```bash
docker compose version   # ✓ v2.x
free -h                  # ✓ ~2 GiB swap
```

## 4. Build the image here, ship it (~10 min, every deploy)

On the **dev machine**:

```bash
cd ~/Projects/axon
pnpm backend:image                                # builds axon-backend:local
docker save axon-backend:local | gzip > /tmp/axon-backend.tar.gz
scp /tmp/axon-backend.tar.gz ubuntu@<IP>:~/
```

On the **server**: `gunzip -c ~/axon-backend.tar.gz | docker load` (✓ "Loaded image:
axon-backend:local"), then `rm ~/axon-backend.tar.gz`.

Then the code itself (compose file, migrations, contract sources) — from your machine:

```bash
rsync -a --exclude node_modules --exclude .git --exclude .expo \
  --exclude apps/mobile/android --exclude apps/mobile/ios \
  ./ ubuntu@<IP>:~/axon/
```

## 5. Secrets on the server (5 min)

```bash
cd ~/axon
cp .env.aws.example .env.aws
openssl rand -base64 24    # → POSTGRES_PASSWORD
openssl rand -base64 24    # → RABBITMQ_PASSWORD
nano .env.aws              # fill POSTGRES_PASSWORD, RABBITMQ_PASSWORD,
                           # DATABASE_URL=postgresql://axon:<pg-pass>@db:5432/axon,
                           # FIREBASE_PROJECT_ID, ZAI_API_KEY, GEMINI_API_KEY
chmod 600 .env.aws
```

## 6. Launch & verify (~3 min — no build on the server!)

```bash
cd ~/axon
docker compose --env-file .env.aws -f docker-compose-prod.yaml up -d
docker compose --env-file .env.aws -f docker-compose-prod.yaml ps      # gate: backend (healthy)
docker compose --env-file .env.aws -f docker-compose-prod.yaml logs backend | tail
# ✓ "prisma migrate deploy" ok → "Server listening"
```

⚠ **Never `--build` on the server** (OOM). Updates always go through §4.

Final gate — phone browser on **mobile data**: `http://<IP>:3001/health` →
`{"status":"ok",...}`.

## 7. Android app via EAS (30 min incl. queue)

1. `apps/mobile/eas.json` — in **both** profiles' `env`:
   - `EXPO_PUBLIC_API_URL=http://<IP>:3001`
   - the 4 `EXPO_PUBLIC_FIREBASE_*` values from §1.3
2. Commit, then:

```bash
npm i -g eas-cli && eas login
cd apps/mobile && eas build -p android --profile preview
```

First run: "Generate a new Android Keystore?" → **Yes**. Wait ~10–20 min → open the
build URL **on the phone** → **Install** (allow unknown sources) → open Axon.

3. **Smoke gate (mobile data, WiFi off):** sign up → create skill → GENERATING → lesson
   renders → quiz → submit → results → **next class appears**. That exercises
   phone → backend → Postgres/Qdrant → AI keys → job queue.

## 8. Runbook

| Task | Command |
|---|---|
| **Deploy an update** | dev: `pnpm backend:image` → `docker save … \| gzip` → `scp` → server: `docker load` → `docker compose --env-file .env.aws -f docker-compose-prod.yaml up -d` (no `--build`!) — migrations apply at container start |
| Logs | `docker compose --env-file .env.aws -f docker-compose-prod.yaml logs -f backend` (or `db`, `qdrant`, `rabbitmq`) |
| DB backup | `docker compose --env-file .env.aws -f docker-compose-prod.yaml exec db pg_dump -U axon -d axon > backup-$(date +%F).sql` → scp off-box |
| RabbitMQ UI | `ssh -L 15672:127.0.0.1:15672 ubuntu@<IP>` → http://localhost:15672 |
| Memory check | `free -h`; if swapping: drop rabbitmq first |
| Instance state | Keep it **Running** 24/7 (free tier covers it). Stop/Start = new IP = APK rebuild |

## 9. Security notes & known deviations

- Attack surface: SSH (your IP) + port 3001. Postgres/Qdrant/RabbitMQ are internal to
  the docker network. **Qdrant has no auth — never publish 6333/6334.**
- **No TLS (user decision)**: tokens (~1 h validity) and content are visible to a
  network observer; use a unique Firebase password. Before any public rollout, restore
  TLS — the self-signed-CA variant (Caddy + APK-bundled CA) is preserved in this file's
  git history.
- `.env.aws` never enters git (`.gitignore`) or the docker build context
  (`.dockerignore` excludes `.env*`, `apps/mobile`).
- RabbitMQ runs per user decision (2026-09-22), unused; supersedes Phase 7 S6.
- Free tier ends after 12 months ⇒ ≈$11/mo flat. Zero-config alternative then: Oracle
  Cloud always-free ARM tier (images are multi-arch) — out of scope until needed.

## 10. After first deploy — check these boxes

- [ ] Billing **zero-spend budget** alarm created (§2.2) — expect $0
- [ ] `http://<IP>:3001/health` returns `{"status":"ok"}` from the phone on mobile data
- [ ] `docker compose ps`: backend `healthy`, nothing restarting; `free -h` shows swap
- [ ] Full learn loop on the phone (create → generate → quiz → next class)
- [ ] `backup-*.sql` produced and stored off-box
- [ ] Instance marked "never Stop/Start casually" (IP is in the APK)
