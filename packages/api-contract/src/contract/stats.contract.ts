import { oc } from '@orpc/contract';
import * as schema from '../schema/stats.schema.js';

const overview = oc
  .route({
    method: "GET",
    path: `/stats/overview`,
    summary: "Learning stats: streak, weekly activity, per-skill totals",
    tags: ["Stats", "Overview"],
  })
  .output(schema.StatsOverviewOutput);

const report = oc
  .route({
    method: "GET",
    path: `/usage/report`,
    summary: "AI token usage and estimated cost (per user, optionally per skill)",
    tags: ["Stats", "Usage"],
  })
  .input(schema.UsageReportInput)
  .output(schema.UsageReportOutput);

export const statsContract = {
  overview,
  report,
}

export type StatsContractType = typeof statsContract;
