import { Icon } from '@atomics/icon';
import { PulseDot } from '@atomics/pulse-dot';
import { Skeleton } from '@atomics/skeleton';
import { Text } from '@atomics/text';
import { Settings, Pin, ChevronRight, Plus } from 'lucide-react-native';
import { formatRelativeDate } from '@/lib/format';
import { usePinnedSkills } from '@/lib/pins';
import { Skill } from '@/types/skill';
import { Link } from 'expo-router';
import { FC, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

/** GENERATING means the AI initialization job is still running. */
const isPreparing = (skill: Skill) => skill.status === 'GENERATING';

const lastStudiedLabel = (skill: Skill): string =>
  skill.lastActivityAt ? formatRelativeDate(skill.lastActivityAt) : 'not started';

const SkillRow: FC<{ skill: Skill; pinned: boolean; onTogglePin: () => void }> = ({
  skill,
  pinned,
  onTogglePin,
}) => {
  return (
    <Link asChild href={`/skill/${skill.id}`}>
      <Pressable
        onLongPress={onTogglePin}
        delayLongPress={350}
        className="bg-background px-6 py-4 active:bg-accent">
        <View className="flex-row items-center gap-3">
          <View className="flex-1 gap-1">
            <View className="flex-row items-center gap-1.5">
              {pinned && (
                <Icon as={Pin} size={13} className="text-muted-foreground" fill="currentColor" />
              )}
              <Text
                numberOfLines={1}
                className="flex-shrink font-serif-medium text-[19px] leading-[26px] tracking-tight">
                {skill.topic}
              </Text>
              {isPreparing(skill) && <PulseDot />}
            </View>

            <Text variant="meta">
              Started {formatRelativeDate(skill.createdAt)} · Last studied {lastStudiedLabel(skill)}
            </Text>

            <View className="flex-row items-center gap-2">
              {isPreparing(skill) && (
                <Text className="text-[13px] text-muted-foreground">Preparing…</Text>
              )}
              <Text variant="meta">
                {skill.lessonCount} {skill.lessonCount === 1 ? 'lesson' : 'lessons'} ·{' '}
                {skill.completedLessons} done · {skill.learnedPoints} learned
              </Text>
            </View>
          </View>

          <Icon as={ChevronRight} size={16} className="text-muted-foreground" strokeWidth={2} />
        </View>
      </Pressable>
    </Link>
  );
};

const ListSeparator = () => <View className="border-hairline border-border" />;

export const SkillListSkeleton: FC = () => (
  <View className="px-6 pt-2">
    <View className="gap-1 pb-5">
      <Skeleton className="h-9 w-44 rounded-lg" />
      <Skeleton className="h-3.5 w-20 rounded-sm" />
    </View>
    {[0, 1, 2, 3].map((row) => (
      <View key={row}>
        <View className="flex-row items-center gap-4 py-4">
          <Skeleton className="size-4 rounded-sm" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-5 w-3/5 rounded-sm" />
            <Skeleton className="h-3.5 w-1/4 rounded-sm" />
          </View>
        </View>
        {row < 3 && <ListSeparator />}
      </View>
    ))}
  </View>
);

export const SkillList: FC<{
  skills: Skill[];
  onNewSkill: () => void;
  onOpenSettings: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}> = ({ skills, onNewSkill, onOpenSettings, refreshing, onRefresh }) => {
  const pinnedIds = usePinnedSkills((s) => s.pinnedIds);
  const togglePin = usePinnedSkills((s) => s.toggle);

  // Pinned skills surface first, in pin order; the rest keep recency order.
  const ordered = useMemo(() => {
    const pinned = pinnedIds
      .map((id) => skills.find((skill) => skill.id === id))
      .filter((skill): skill is Skill => skill !== undefined);
    const rest = skills.filter((skill) => !pinnedIds.includes(skill.id));
    return [...pinned, ...rest];
  }, [skills, pinnedIds]);

  return (
    <FlatList
      data={ordered}
      style={{ flex: 1 }}
      renderItem={({ item: skill }) => (
        <SkillRow
          skill={skill}
          pinned={pinnedIds.includes(skill.id)}
          onTogglePin={() => togglePin(skill.id)}
        />
      )}
      keyExtractor={(skill) => skill.id.toString()}
      ItemSeparatorComponent={ListSeparator}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="hsl(0 0% 45%)" />
      }
      ListHeaderComponent={
        <View>
          <View className="flex-row items-end justify-between px-6 pb-5 pt-2">
            <View className="gap-1">
              <Text variant="title">Library</Text>
              <Text variant="meta">
                {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={onOpenSettings}
              className="size-10 items-center justify-center rounded-full active:bg-accent">
              <Icon as={Settings} size={20} strokeWidth={1.75} />
            </Pressable>
          </View>
          <ListSeparator />
        </View>
      }
      ListFooterComponent={
        <>
          <ListSeparator />
          <Pressable
            accessibilityLabel="New skill"
            onPress={onNewSkill}
            className="flex-row items-center justify-center gap-2 py-5 active:opacity-60">
            <Icon as={Plus} size={16} className="text-muted-foreground" />
            <Text className="text-sm text-muted-foreground">New skill</Text>
          </Pressable>
        </>
      }
    />
  );
};
