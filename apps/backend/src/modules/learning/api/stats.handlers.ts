import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import {
  makeGetLearningStats,
  type GetLearningStatsDeps,
} from "@/modules/learning/application/queries/get-learning-stats";

export type StatsApiDeps = GetLearningStatsDeps;

export const makeStatsHandlers = (deps: StatsApiDeps) => {
  const getLearningStats = makeGetLearningStats(deps);

  return {
    overview: (async ({ context }) =>
      getLearningStats({ userId: context.user.id })) satisfies OrpcHandler<
      unknown,
      z.infer<typeof schema.stats.StatsOverviewOutput>
    >,
  };
};
