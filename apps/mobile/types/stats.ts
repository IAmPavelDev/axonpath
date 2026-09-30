import type { z } from 'zod';
import { schema } from '@axon/api-contract';

/** stats.overview response: streak, weekly activity, per-skill totals. */
export type StatsOverview = z.infer<typeof schema.stats.StatsOverviewOutput>;
