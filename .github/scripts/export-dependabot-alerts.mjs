// Export Dependabot alerts to CSV via the GitHub GraphQL API.
//
// Drop-in replacement for ambilykk/dependabot-alert-export (unmaintained since
// 2023, pinned to the retired node16 runner): same GraphQL query and 18 CSV
// columns — minus the action's `fixReason`, a field GitHub has since removed
// from the RepositoryVulnerabilityAlert schema. Paginated 50 alerts per page.
// Runs on the built-in GITHUB_TOKEN — needs only `vulnerability-alerts: read`.
//
// Usage: node export-dependabot-alerts.mjs [output.csv]
// Env:   GH_TOKEN (required), REPOSITORY ("owner/name", required),
//        GITHUB_STEP_SUMMARY (optional — gets a Markdown run summary).

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const token = process.env.GH_TOKEN;
const [owner, repo] = (process.env.REPOSITORY ?? "").split("/");
const csvPath = process.argv[2] ?? "reports/dependabot-alerts.csv";

if (!token || !owner || !repo) {
  console.error("GH_TOKEN and REPOSITORY (owner/name) are required");
  process.exit(1);
}

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// Same query as ambilykk/dependabot-alert-export@v1.0, minus `fixReason`.
const query = `query ($org_name: String! $repo_name: String! $pagination: String){
    repository(owner: $org_name name: $repo_name) {
      name
      vulnerabilityAlerts(first: 50 after: $pagination) {
        pageInfo {
            hasNextPage
            endCursor
        }
        totalCount
        nodes {
          id
          createdAt
          state
          dismissedAt
          dismissReason
          dismissComment
          fixedAt
          dependencyScope
          repository{
            name
            owner{
              login
            }
          }
          securityAdvisory {
              ghsaId
              description
              permalink
              severity
              summary
          }
          securityVulnerability {
            package {
              name
            }
            vulnerableVersionRange
          }
          vulnerableManifestFilename
          vulnerableManifestPath
        }
      }
    }
  }`;

// Same columns as the original action, minus `Fix Reason` (dead schema field).
const columns = [
  ["Owner", (n) => n.repository.owner.login],
  ["Repository Name", (n) => n.repository.name],
  ["ID", (n) => n.id],
  ["State", (n) => n.state],
  ["Scope", (n) => n.dependencyScope],
  ["Created At", (n) => n.createdAt],
  ["Manifest File Name", (n) => n.vulnerableManifestFilename],
  ["Vulnerability Version Range", (n) => n.securityVulnerability?.vulnerableVersionRange],
  ["Package Name", (n) => n.securityVulnerability?.package?.name],
  ["GHSA Id", (n) => n.securityAdvisory?.ghsaId],
  ["Severity", (n) => n.securityAdvisory?.severity],
  ["Summary", (n) => n.securityAdvisory?.summary],
  ["Link", (n) => n.securityAdvisory?.permalink],
  ["Description", (n) => n.securityAdvisory?.description],
  ["Dismissed At", (n) => n.dismissedAt],
  ["Dismiss Reason", (n) => n.dismissReason],
  ["Dismiss Comment", (n) => n.dismissComment],
  ["Fixed At", (n) => n.fixedAt],
];

const csvEscape = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

async function fetchAlertsPage(cursor) {
  let res;
  try {
    res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "dependabot-alert-export",
      },
      body: JSON.stringify({
        query,
        variables: { org_name: owner, repo_name: repo, pagination: cursor ?? null },
      }),
    });
  } catch (err) {
    fail(`GraphQL request failed: ${err.message}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) fail(`GraphQL endpoint returned HTTP ${res.status}`);
  if (body?.errors?.length) fail(body.errors.map((e) => e.message).join("; "));
  const alerts = body?.data?.repository?.vulnerabilityAlerts;
  if (!alerts) fail("Unexpected GraphQL response shape (is Dependabot alerts enabled for this repo?)");
  return alerts;
}

const MAX_PAGES = 100; // 50 alerts/page -> hard stop at 5000 alerts
const nodes = [];
let totalCount = 0;
let cursor = null;
for (let page = 1; page <= MAX_PAGES; page++) {
  const result = await fetchAlertsPage(cursor);
  if (page === 1) totalCount = result.totalCount;
  nodes.push(...result.nodes);
  console.log(`page ${page}: ${result.nodes.length} alerts (total ${totalCount})`);
  if (!result.pageInfo.hasNextPage) break;
  cursor = result.pageInfo.endCursor;
  if (page === MAX_PAGES) fail(`Alert count exceeds ${MAX_PAGES * 50}; increase MAX_PAGES`);
}

const rows = [columns.map(([label]) => label).join(",")];
for (const node of nodes) {
  rows.push(columns.map(([, get]) => csvEscape(get(node))).join(","));
}
mkdirSync(dirname(csvPath), { recursive: true });
writeFileSync(csvPath, rows.join("\r\n") + "\r\n");
console.log(`Wrote ${nodes.length} of ${totalCount} alerts to ${csvPath}`);

const tally = (key) =>
  Object.entries(
    nodes.reduce((acc, n) => ((acc[n[key]] ??= 0), (acc[n[key]] += 1), acc), {}),
  )
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Dependabot alert export",
      "",
      `- Total alerts: **${totalCount}**`,
      `- By state: ${tally("state") || "none"}`,
      `- By severity: ${tally("securityAdvisory.severity") || "none"}`,
      `- Report: \`${csvPath}\` (artifact \`dependabot-alerts\`)`,
      "",
    ].join("\n"),
  );
}
