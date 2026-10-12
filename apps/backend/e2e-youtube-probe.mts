/**
 * Live YouTube unofficial-path probe — runs the real scraper client from the
 * current runtime (dev host, docker container, or Lambda). No API keys, no
 * quota, no LLM calls: this measures whether InnerTube search, the watch page
 * (player response), and timedtext transcripts are reachable from HERE.
 *
 * Dev host:
 *   pnpm --filter @axon/backend exec tsx e2e-youtube-probe.mts [query] [videoId]
 *
 * Lambda (the actual experiment): build + push the image, then invoke the
 * `video.probe` oRPC procedure against the API Gateway URL. The probe
 * procedure requires Firebase auth like every other procedure.
 *
 * Exit code 0 = search + watch page + transcript all reachable, no bot wall;
 * 1 = anything degraded (the JSON report says which step and why).
 */
import { createRequire } from "node:module";

// CJS interop boundary: the backend package is CommonJS, and esbuild's
// getter-based exports are invisible to ESM named-import detection. require()
// reads module.exports directly, so the named factories are plain properties.
const require = createRequire(import.meta.url);
const scraperFactory = require("./src/modules/video/infrastructure/youtube-scraper.client.js") as typeof import("./src/modules/video/infrastructure/youtube-scraper.client.js");
const probeFactory = require("./src/modules/video/application/probe-youtube-access.js") as typeof import("./src/modules/video/application/probe-youtube-access.js");

const query = process.argv[2] ?? "javascript closures explained";
const videoId = process.argv[3] ?? null;

const probe = probeFactory.makeProbeYoutubeAccess({
  scraper: scraperFactory.makeYoutubeScraperClient(),
  clock: { now: () => new Date() },
});

const report = await probe({ query, videoId });
console.log(JSON.stringify(report, null, 2));

const botWall =
  report.watchPage.playabilityStatus === "LOGIN_REQUIRED" ||
  (report.watchPage.playabilityReason ?? "").toLowerCase().includes("bot");
const operational =
  report.search.ok && report.watchPage.ok && report.transcript.ok && !botWall;

console.log(operational ? "\nPROBE: OPERATIONAL" : "\nPROBE: DEGRADED/BLOCKED");
process.exit(operational ? 0 : 1);
