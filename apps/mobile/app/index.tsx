import { Button } from '@atomics/button';
import { SkillList, SkillListSkeleton } from '@components/skill/SkillList';
import { Icon } from '@atomics/icon';
import { Settings } from 'lucide-react-native';
import { Text } from '@atomics/text';
import { Skill } from '@/types/skill';
import { usePinnedSkills } from '@/lib/pins';
import rpc from '@/utils/rpc';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Screen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hydratePins = usePinnedSkills((s) => s.hydrate);

  useEffect(() => {
    hydratePins();
  }, [hydratePins]);

  const { data: skills, isLoading, error, refetch, isRefetching } = useQuery<Skill[]>({
    queryKey: ['skillList'],
    queryFn: () => rpc.skill.list(),
  });

  if (isLoading) {
    return <SkillListSkeleton />;
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text variant="muted">{error.message}</Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  if (!skills || skills.length === 0) {
    return (
      <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
        <View className="flex-row justify-end px-3 pt-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings')}
            className="size-10 items-center justify-center rounded-full active:bg-accent">
            <Icon as={Settings} size={20} strokeWidth={1.75} />
          </Pressable>
        </View>
        <View
          className="flex-1 items-center justify-center gap-5 px-10"
          style={{ marginBottom: '25%' }}>
          <Text className="text-center font-sans-medium text-[28px] leading-[34px] tracking-tight">
            What will you learn?
          </Text>
          <Text className="text-center text-[15px] leading-6 text-muted-foreground">
            Name any topic. Axon writes the first lesson and a quiz to go with it.
          </Text>
          <Button size="lg" onPress={() => router.push('/skill/create')}>
            <Text>Start learning</Text>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
      <SkillList
        skills={skills}
        onNewSkill={() => router.push('/skill/create')}
        onOpenSettings={() => router.push('/settings')}
        refreshing={isRefetching}
        onRefresh={refetch}
      />
    </View>
  );
}
