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

export const statsContract = {
  overview,
}

export type StatsContractType = typeof statsContract;
