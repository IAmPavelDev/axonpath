import rpc from '@/utils/rpc';
import { useQuery } from '@tanstack/react-query';

/**
 * Learning stats for the home card. React Query defaults keep it
 * stale-while-revalidate — deliberately no polling: the numbers move on the
 * scale of days, not seconds.
 */
export function useStatsOverview() {
  return useQuery({
    queryKey: ['statsOverview'],
    queryFn: () => rpc.stats.overview(),
  });
}
