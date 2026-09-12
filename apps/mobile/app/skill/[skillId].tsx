import { SkillDetail } from '@components/skill/SkillDetail';
import { Spinner } from '@atomics/spinner';
import { useLocalSearchParams } from 'expo-router';

export default function Route() {
  const { skillId } = useLocalSearchParams<{ skillId: string }>();
  const id = Number(skillId);

  if (!Number.isFinite(id)) {
    return <Spinner />;
  }

  return <SkillDetail skillId={id} />;
}
