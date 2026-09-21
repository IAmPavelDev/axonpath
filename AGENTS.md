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
