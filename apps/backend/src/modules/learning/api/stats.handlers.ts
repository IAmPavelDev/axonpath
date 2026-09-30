import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import { toORPCError } from "@/modules/platform/api/error-mapping";
import { unwrapOrThrow } from "@/modules/platform/result";
import {
  makeGetLearningStats,
  type GetLearningStatsDeps,
} from "@/modules/learning/application/queries/get-learning-stats";
import {
  makeGetUsageReport,
  type GetUsageReportDeps,
} from "@/modules/learning/application/queries/get-usage-report";

export type StatsApiDeps = GetLearningStatsDeps & GetUsageReportDeps;

export const makeStatsHandlers = (deps: StatsApiDeps) => {
  const getLearningStats = makeGetLearningStats(deps);
  const getUsageReport = makeGetUsageReport(deps);

  return {
    overview: (async ({ context }) =>
      getLearningStats({ userId: context.user.id })) satisfies OrpcHandler<
      unknown,
      z.infer<typeof schema.stats.StatsOverviewOutput>
    >,

    report: (async ({ input, context }) => {
      const result = await getUsageReport({
        userId: context.user.id,
        skillId: input?.skillId,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.stats.UsageReportInput>,
      z.infer<typeof schema.stats.UsageReportOutput>
    >,
  };
};
