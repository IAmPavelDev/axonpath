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

`pnpm audit --fix` (pnpm ≥ 10) writes `pnpm.overrides` into the root
package.json for every advisory with a compatible patched version, then
`pnpm install` applies them. Review the overrides diff before committing —
they pin floors, which is fine for security but should be pruned later when
parents update naturally.

```bash
pnpm audit --fix
pnpm install
pnpm --filter @axon/api-contract build && pnpm --filter @axon/backend test
pnpm --filter @axon/mobile exec tsc --noEmit
```

Expected to clear ~25 of the 34 packages, including shell-quote, @xmldom,
postcss, nanoid, minimatch, glob, browserslist, rollup, undici, js-yaml, yaml.

### Batch C — forced-major transitive bumps (judgment calls)

These need overrides that jump a major, outside the parent's declared range:

| Package | Fix | Parent pins (verified in node_modules) | Call |
|---|---|---|---|
| @grpc/grpc-js 1.9.16 | ≥ 1.13.6 | @firebase/firestore pins `~1.9.0` — forced | try `pnpm up -r @react-native-firebase/*` first (newer firebase may pull grpc 1.13); else override to `^1.13.6` — same major, then smoke-test Firestore login on device |
| deepmerge-ts 7.1.5 → 8 | major | @prisma/config pins exact `7.1.5` | defer — revisit at the prisma major upgrade; advisory is config-parse stack exhaustion, build-time only |
| esbuild 0.27.7 → 0.28.1 | minor | vite 8.3.0 has it as peer (multi-version: tsx pulls 0.25.9 too) | defer — LOW, dev-only; refreshes itself at the next vitest/tsx update |
| uuid 7.0.3 → 11.1.1 | major | xcode plugin pins `^7.0.3` — forced | override acceptable (build-time only); run `expo prebuild` to confirm, else revert and dismiss |
| braces, node-forge | — | no patch exists upstream | dismiss (Batch D) |

After B, re-run `pnpm audit --json` — whatever remains open is exactly this
table; decide each explicitly.

### Batch D — dismiss the two no-patch advisories

GitHub UI → Security → Dependabot alerts → braces / node-forge → Dismiss →
reason "Fix started later" is wrong here; use a custom comment:
`No patched release exists; dev/build-time dependency only (nodemon>chokidar /
expo>@expo/cli). Re-open when upstream ships a fix.`
Dismissal via REST also works: `PATCH /repos/IAmPavelDev/axonpath/dependabot/alerts/{N}`
with `{"state":"dismissed","dismissed_reason":"no_fix","dismissed_comment":"..."}`.
GitHub auto-reopens alerts if a fix lands later.

### Verify end-to-end

```bash
pnpm --filter @axon/api-contract build
pnpm --filter @axon/backend test
pnpm --filter @axon/mobile exec tsc --noEmit
pnpm audit   # expect: only the 2 dismissed + any deferred from Batch C
```

Then push to `dev` — `deploy.yml` auto-deploys and smoke-tests `/health` on
Lambda. Re-run the export workflow (Actions → dependabot-alert-export) and
re-download the CSV: OPEN should be 0 (2 rows become DISMISSED).

### Prevention (optional, one file)

Add `.github/dependabot.yml` with `package-ecosystem: "npm"` +
`directories: ["/", "/apps/backend", "/apps/mobile", "/packages/api-contract"]`
so version updates arrive as PRs instead of accumulating into 111 alerts.
