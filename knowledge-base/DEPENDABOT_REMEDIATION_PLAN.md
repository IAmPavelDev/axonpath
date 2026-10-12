# Dependabot Remediation Plan

Generated 2026-10-12 from the first export of
`.github/workflows/dependabot-alert-export.yml` (`dependabot-alerts.csv`, 182
rows) cross-referenced with `pnpm audit` (10.14.0). The two sources agree
exactly: 111 OPEN alerts, 34 distinct packages, all in the root
`pnpm-lock.yaml` (backend + mobile + api-contract share it). Severity split:
2 critical, 71 high, 31 moderate, 7 low. The 71 FIXED rows are already
resolved — not part of this plan.

Only 5 packages are direct dependencies; everything else is transitive.
`^`-ranges mean most fixes land without touching declared versions.

## Current state

### Direct dependencies (fix = version bump, in-range)

| Package | Severity | Where | Installed | Fix |
|---|---|---|---|---|
| @orpc/client | **CRITICAL** | backend, mobile | 1.8.5 / 1.8.6 | ≥ 1.13.6 (prototype pollution in RPC deserialization) |
| @orpc/openapi | HIGH | backend | 1.8.6 | ≥ 1.13.9 (stored XSS in OpenAPI reference plugin) |
| @orpc/server | MODERATE | backend, api-contract | 1.8.5 / 1.8.6 | ≥ 1.14.8 (CORS vary-header injection) |
| @orpc/zod | MODERATE | backend | 1.8.6 | ≥ 1.14.10 (prototype injection in coercion) |
| fastify | HIGH | backend | 5.5.0 | ≥ 5.12.2 (header validation bypass; also pulls find-my-way ≥ 9.7) |

### Transitive, grouped by real exposure

**Backend runtime (internet-facing — highest priority):**

| Package | Sev | Installed | Fix | Chain |
|---|---|---|---|---|
| find-my-way | HIGH | 9.3.0 | ≥ 9.7.0 | fastify (covered by fastify bump) |
| undici | MOD | 7.29.0 | ≥ 7.29.1 | @qdrant/js-client-rest |
| ajv | MOD | 8.17.1 | ≥ 8.18.0 | @fastify/env → env-schema |
| fast-uri | HIGH+MOD | 3.1.0 | ≥ 3.1.8 | @fastify/env → env-schema → ajv |
| deepmerge-ts | HIGH | 7.1.5 | ≥ 8.0.0 (major) | prisma → @prisma/config |

**Mobile runtime (bundled in the APK):**

| Package | Sev | Installed | Fix | Chain |
|---|---|---|---|---|
| markdown-it | MOD | 14.1.0 | ≥ 14.3.1 | react-native-markdown-x (renders app content) |
| linkify-it | HIGH | 5.0.0 | ≥ 5.0.2 | react-native-markdown-x → markdown-it |
| @grpc/grpc-js | HIGH+LOW | 1.9.16 | ≥ 1.13.6 | firebase → @firebase/firestore |
| decode-uri-component | MOD | 0.2.2 | ≥ 0.5.0 | expo-router → query-string |

**Build/dev tooling (no production exposure — batch-fix, don't over-think):**
expo/@expo/cli chains (@xmldom/xmldom 0.8.11→0.8.15, js-yaml 4.1.0→4.3.2,
compression →1.8.2, node-forge, uuid 7.0.3), tailwind/babel chains (postcss
8.5.6→8.5.18+, nanoid 3.3.11→3.3.12+, minimatch 9.0.5→9.0.7, glob
10.4.5→10.5.0, brace-expansion, browserslist →4.28.7,
postcss-selector-parser), react-native devtools (shell-quote 1.8.3→1.9.0,
**CRITICAL** advisory but devtools only), vitest/vite (esbuild, yaml,
source-map-js), tsup (rollup 4.50.0→4.59.0), nodemon (picomatch 2.3.1→2.3.2,
braces).

Note on shell-quote: the CRITICAL advisory rides
`react-native → react-devtools-core`, which is not in release bundles — treat
as dev-time despite the label.

### No upstream fix exists (2)

| Package | Sev | Chain | Advisory |
|---|---|---|---|
| braces | HIGH | nodemon → chokidar (dev) | stack exhaustion; patched version `<0.0.0` = none released |
| node-forge | HIGH | expo → @expo/cli (build) | RSA PKCS#1 v1.5 verification; none released |

## Plan

### Batch A — direct bumps (do first, includes the only critical)

```bash
pnpm up -r '@orpc/*' fastify   # in-range: @orpc/* → 1.14.x, fastify → 5.12.x
pnpm ls -r --depth 0 @orpc/client @orpc/server fastify   # confirm versions
pnpm --filter @axon/api-contract build   # contract FIRST (backend resolves dist/)
pnpm --filter @axon/backend test         # 286 tests
pnpm --filter @axon/mobile exec tsc --noEmit
```

Risk: @orpc 1.8 → 1.14 spans several minors; oRPC is 1.x so semver says no
breaking changes, but the backend exercises client/server/contract heavily —
the 286-test suite is the real gate. fastify 5.5 → 5.12 is patch-level.
Watch the zod peer: api-contract has zod ^4.1.5, @orpc/zod 1.14 expects zod 4.
@orpc/server 1.14 also peers on `ws >=8.18.1` + `crossws >=0.3.4` — the Batch B
ws bump satisfies ws; add the missing peer to backend only if `pnpm install`
warns. The fastify 5.12.2 bump covers find-my-way (it declares `^9.6.0`).

### Batch B — transitive patch sweep (most of the 111)

**pnpm 10.14.0 ignores `overrides` in pnpm-workspace.yaml whenever root
`package.json` has a `resolutions` field** — the yarn-compat `resolutions`
block (added in f351f53 for lightningcss) shadows the workspace overrides
entirely, so `pnpm audit --fix`-written overrides are silently dropped and
fresh resolutions stamp only the `resolutions` entries into the lockfile.
`pnpm audit --fix` is therefore doubly useless here. Discovered 2026-10-12:
every override attempt "skipped resolution" until the floors were written
into `resolutions` itself and the lockfile deleted for a fresh resolve.

**Applied fix (commit round 2):** floors live in root `package.json`
`resolutions`: undici `^7.29.1`, deepmerge-ts `^8.0.0`,
decode-uri-component `^0.5.0`, esbuild `^0.28.1` (lightningcss pin kept).
Caret-locks matter: a bare `>=` floor lets the override jump majors
(sandbox showed undici resolving to 8.x under `>=7.29.1`).

For the remaining in-range sweep (no override needed — parents with `^`
ranges re-resolve to patched versions):

```bash
pnpm -r update @xmldom/xmldom ajv brace-expansion browserslist compression \
  fast-uri glob js-yaml linkify-it markdown-it minimatch nanoid picomatch \
  postcss rollup shell-quote source-map-js ws yaml
```

Cleared 21 of 34 packages (111 → 19 advisories), including the CRITICAL
shell-quote (react-devtools-core, dev-only anyway), @xmldom, postcss, nanoid,
minimatch, glob, browserslist, rollup, js-yaml, yaml, markdown-it, linkify-it,
compression, ajv, fast-uri, picomatch, brace-expansion, source-map-js, ws.

### Batch C — forced-major transitive bumps (judgment calls)
Final dispositions after the resolutions fix (verified against installed
parents + registry):

| Package | Parent pins | Disposition |
|---|---|---|
| undici 7.29.0 | qdrant 1.19.0 (latest) pins exact `7.29.0` | **FIXED via resolutions** → 7.30.0 (stays on 7.x); advisory is undici's WebSocket path, unused by the REST client anyway |
| deepmerge-ts 7.1.5 | @prisma/config pins exact `7.1.5` | **FIXED via resolutions** → 8.0.2; verified via `prisma generate` + full backend battery |
| decode-uri-component 0.2.2 | expo-router → query-string owns it | **FIXED via resolutions** → 0.5.0 |
| esbuild 0.27.7 | vite 8.3 peer (tsx pulls 0.25.9 too) | **FIXED via resolutions** → 0.28.2; verified via full vitest run |
| postcss-selector-parser 6.1.4 | tailwindcss pins `^6` | defer — fix is 7.x major; forcing it risks the mobile tailwind build. Build-time quadratic complexity only |
| uuid 7.0.3 | xcode plugin pins `^7.0.3` | defer — fix is uuid 11 major; the advisory path (v3/v5/v6 with `buf`) is never exercised by xcode, build-time only |
| @grpc/grpc-js, braces, node-forge | grpc: firestore pins `~1.9.0` and app never imports firestore; others: no patch exists | dismissed on GitHub ("Not used" / "Tolerable risk") |

### Batch D — dismiss three advisories (user action, needs GitHub auth)

GitHub UI → Security → Dependabot alerts → Dismiss, with custom comments:

- `braces` / `node-forge`: `No patched release exists; dev/build-time
  dependency only (nodemon>chokidar / expo>@expo/cli). Re-open when upstream
  ships a fix.`
- `@grpc/grpc-js`: `firebase/firestore chain is never imported by the app, so
  grpc-js is not bundled in release builds. Reopen if Firestore is adopted.`

Dismissal via REST also works: `PATCH /repos/IAmPavelDev/axonpath/dependabot/alerts/{N}`
with `{"state":"dismissed","dismissed_reason":"no_fix","dismissed_comment":"..."}`.
GitHub auto-reopens alerts if a fix lands later.

### Verify end-to-end

```bash
pnpm --filter @axon/api-contract build
pnpm --filter @axon/backend test
pnpm --filter @axon/mobile exec tsc --noEmit
pnpm audit   # expect: postcss-selector-parser + uuid only (2 advisories);
            # grpc-js/braces/node-forge also appear in audit but are dismissed on GitHub
```

Then push to `dev` — `deploy.yml` auto-deploys and smoke-tests `/health` on
Lambda. Re-run the export workflow (Actions → dependabot-alert-export) and
re-download the CSV: the 2 dismissed-by-fix-cycle-1 and 3 dismissals show as
DISMISSED; only postcss-selector-parser + uuid stay OPEN until tailwindcss
and expo release compatible parents.

### Prevention (optional, one file)

Add `.github/dependabot.yml` with `package-ecosystem: "npm"` +
`directories: ["/", "/apps/backend", "/apps/mobile", "/packages/api-contract"]`
so version updates arrive as PRs instead of accumulating into 111 alerts.
