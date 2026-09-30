# Axon — Business Decisions Context

> Created 2026-09-30 from a verified audit of the docs and git history (HEAD `48c484b`).
> This file records the durable business, product, and operations decisions behind Axon —
> the *why* that outlives any single phase. Technical current state: `ARCHITECTURE.md`;
> execution authority for what is next: `PHASE7_POST_BETA.md`; product intent:
> `CONCEPT.md`; deployment economics: `DEPLOY_AWS_BETA.md`.
> Update rule: every decision that changes scope, money, sequencing, or UX direction gets a
> row here in the same change that implements it.

## 1. Product decisions

| # | Decision | Rationale / rejected alternative | When |
|---|---|---|---|
| P1 | **The adaptive loop is the product.** Everything else is hardening or deferral. Beta = a single-author, working loop a non-developer can use (≤5 users). | Rejected: building admin panels, billing, multi-tenancy first. `CONCEPT.md` §8 non-goals. | 2026-09 (ROADMAP) |
| P2 | **Per-user vector memory is the strategic differentiator.** `AI_INITIAL`/`AI_NEXT` write+retrieve shipped; `ANSWER_DERIVED` mistake memory shipped (Phase 7 S3). | Retrieval over atomic snippets beats dumping full history into prompts; keeps token cost flat. | 2026-09 (CONCEPT) |
| P3 | **Android-only beta**, distributed as a universal APK (all ABIs) via EAS cloud builds (free plan). No iOS, no store release. | Emulator + real phones covered; store review is a post-beta problem. `8029e7d` | 2026-09-27 |
| P4 | **Ask-AI inside conspects** (2026-09-29/30): native text selection → anchored Q&A block in the lesson (`class.qa.ask`), answered asynchronously; stranded blocks requeued on boot. | Enriches the read→ask loop cheaply while Phase 7 waits; Q&A is on the request-adjacent path, generation stays in jobs. `6c1efeb`, `e4ea158`, `457b740` | 2026-09-29 |
| P5 | **Post-quiz feedback = status, not a loading screen.** Quiz "continue" routes back to the skill's lesson list; the skill row/detail shows a "Preparing your next lesson…" line while `GENERATING`; no dedicated generating screen, no client-side `class.list` polling; the home list polls `skill.list` every 10 s while visible. | "Preparing" status is enough signal; the backend composes lessons durably (sweeper recovers lost jobs), so the client doesn't need to babysit generation. Rejected: 2.5 s polling + 90 s timeout + auto-nav (brittle, wasted requests). `e988e6e`, `7dd5af7` | 2026-09-30 |
| P6 | **Non-goals (still):** multi-user scaling, billing/monetization, web admin, user-generated content, spaced-repetition scheduling, `SkillProgress` snapshots, broker adoption. | Revisit only after the loop proves sticky with real users. | standing |

## 2. Money & infrastructure posture

| # | Decision | Rationale / numbers | When |
|---|---|---|---|
| M1 | **$0-run-rate beta on AWS all-free edition.** t2.micro (1 vCPU, 1 GiB) + 2 GB swap, 24/7, ≤5 users. | New accounts post-2025-07-15 are on the credits-based Free plan ($100 signup credits, 6-month window, t2.micro ≈ $8.5/mo ⇒ >12 months of coverage). The free plan **auto-closes the account at expiry** — upgrade to Paid (free; credits carry over) when the alerts start. | 2026-09-22, amended `d79e8b5` |
| M2 | **Plain HTTP :3001 on the auto-assigned public IP. No Elastic IP, no TLS, no domain.** | User decision, accepted risk: Firebase ID tokens (~1 h validity) + lesson content cross unencrypted; fine for a 5-person beta. Self-signed HTTPS variant lives in git history. | 2026-09-22 |
| M3 | **The public IP is baked into the APK → the instance is never Stop/Start.** IP change ⇒ `eas.json` update + APK rebuild. | Stop/Start is the only action that rotates an auto-assigned IP; reboot is safe. | 2026-09-22 |
| M4 | **Docker images are built on the dev machine and shipped** (`docker save` → scp → `docker load`). **Never `--build` on the server.** | Build peaks ~2 GB RAM; the host has 1 GiB and OOMs. Runtime residency ≈600 MB is fine. | 2026-09-22 |
| M5 | **AI runs off-box and is treated as an ops cost, not an infra one:** chat `glm-5.3-flash` via Z.ai coding endpoint; embeddings `gemini-embedding-2` via Gemini. Degrade-never-hang on every AI failure (skill → FAILED + retry; retrieval → `[]`; future grading → 0). | Keeps the EC2 instance tiny and the failure policy uniform. Cost per lesson is **unmeasured** — `Event` rows store full prompts/responses and can price it when scaling matters. | 2026-09 |
| M6 | **Supporting services on free plans:** Firebase Spark (auth), EAS free (builds), $0-budget billing alarm on AWS. | No monthly fixed cost anywhere. | 2026-09-22 |
| M7 | **RabbitMQ container is deployed in prod but unused** (~100 MB idle) — first thing to drop if RAM gets tight; dev compose still declares it (Phase 7 S6 removes it). | Kept per user decision during beta deploy; the `JobQueuePort` seam is the architecture, the broker is not. | 2026-09-22 |

## 3. Engineering strategy decisions

| # | Decision | Rationale | When |
|---|---|---|---|
| E1 | **DDD modular monolith, contract-first oRPC** (`@axon/api-contract` is the single API truth; Effect-readiness import rules; only `container.ts` constructs adapters). | One deployable, typed end-to-end; swap-in adapters later if ever needed. | 2026-09 refactor |
| E2 | **Durability only where it pays:** next-class generation is durable (`NextClassJob` + lease + sweeper/reconciler); everything else stays on the in-process fire-and-forget queue. | Retry-worthy work is exactly the AI generation path; a broker is deferred, the seam is kept. `5902e68`/`d6508e8` | 2026-09-22 |
| E3 | **Phase 7 sequencing:** M1 progress/control → M2 memory & quiz depth (S4 grading must land before S5 open-ended generation) → M3 hygiene; docs sync (S8) always last. | Milestones are independent; generating an ungradable question type is the one hard ordering constraint. | 2026-09-22 |
| E4 | **Every phase lands with docs synced in the same change** (ARCHITECTURE/GAPS/plan status lines + phase-file checkboxes). | Docs drift is the failure mode of solo projects; the rule is enforced per phase. | standing |
| E5 | **Verification gates per step:** `pnpm --filter @axon/backend test` + `pnpm --filter @axon/mobile exec tsc --noEmit`; contract-touching steps rebuild `@axon/api-contract` first. | Cheapest bar that catches the two real failure surfaces. | standing |
| E6 | **Dev-machine ops constraint:** the Tailscale exit node is user-managed and never touched; its accepted side effect is Docker losing egress (`EAI_AGAIN`) — report, don't "fix". | The user works in parallel through the tunnel; availability beats convenience. | 2026-09-21 |

## 4. Open business questions (what would change the plan)

1. **Real usage:** if >5 users or any public sharing happens, M1/M2/M3 all need revisiting
   (EIP + TLS + domain, bigger instance or per-service split) — the first real trigger to
   revisit the free-tier posture.
2. **AI spend:** unmeasured per lesson/skill. Before any growth push, price it from the
   `Event` audit log (prompts/responses are stored) and decide whether glm-5.3-flash stays.
3. **Retention signal:** nothing measures whether the adaptive loop actually retains. Cheap
   first step: weekly active skills + lessons-completed per skill, derivable from existing
   tables (no new infra).
4. **Monetization:** consciously none until the loop is proven; the AWS credits plan
   (6-month window) is the only budget clock currently ticking.
