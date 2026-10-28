import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { ApiHandler } from "@/modules/platform/api/handler";
import { toHttpError } from "@/modules/platform/api/error-mapping";
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
    overview: (async (_, context) =>
      getLearningStats({ userId: context.user.id })) satisfies ApiHandler<
      unknown,
      z.infer<typeof schema.stats.StatsOverviewOutput>
    >,

    report: (async (input, context) => {
      const result = await getUsageReport({
        userId: context.user.id,
        skillId: input?.skillId,
      });
      return unwrapOrThrow(result, toHttpError);
    }) satisfies ApiHandler<
      z.infer<typeof schema.stats.UsageReportInput>,
      z.infer<typeof schema.stats.UsageReportOutput>
    >,
  };
};
