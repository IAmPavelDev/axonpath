import rpc from '@/utils/rpc';
import { useQuery } from '@tanstack/react-query';

/**
 * Latest wrong answers per question for one skill. React Query defaults
 * refetch on mount, so re-graded open-ended feedback appears without a
 * rebuild; deliberately no polling.
 */
export function useSkillMistakes(skillId: number) {
  return useQuery({
    queryKey: ['skillMistakes', skillId],
    queryFn: () => rpc.skill.mistakes({ id: skillId }),
  });
}
