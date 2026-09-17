import { Icon } from '@atomics/icon';
import { PulseDot } from '@atomics/pulse-dot';
import { Skeleton } from '@atomics/skeleton';
import { Text } from '@atomics/text';
import { ThemeToggle } from '@components/theme-toggle';
import { formatRelativeDate } from '@/lib/format';
import { Skill } from '@/types/skill';
import { Link } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import { FC } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

/** DRAFT means the AI initialization job is still running. */
const isPreparing = (skill: Skill) => skill.status === 'DRAFT';

const SkillRow: FC<{ skill: Skill; index: number }> = ({ skill, index }) => {
  return (
    <Link asChild href={`/skill/${skill.id}`}>
      <Pressable className="flex-row items-center gap-4 bg-background px-6 py-4 active:bg-accent">
        <Text className="w-6 shrink-0 text-right text-[13px] text-muted-foreground tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </Text>

        <View className="flex-1 gap-0.5">
          <Text
            numberOfLines={1}
            className="font-serif-medium text-[19px] leading-[26px] tracking-tight">
            {skill.topic}
          </Text>
          <View className="flex-row items-center gap-2">
            {isPreparing(skill) ? (
              <>
                <PulseDot />
                <Text className="text-[13px] text-muted-foreground">Preparing…</Text>
              </>
            ) : skill.status !== 'ACTIVE' ? (
              <Text className="text-[13px] text-muted-foreground">{skill.status}</Text>
            ) : null}
            <Text className="text-[13px] text-muted-foreground tabular-nums">
              {formatRelativeDate(skill.createdAt)}
            </Text>
          </View>
        </View>

        <Icon as={ChevronRight} size={16} className="text-muted-foreground" strokeWidth={2} />
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
  refreshing: boolean;
  onRefresh: () => void;
}> = ({ skills, onNewSkill, refreshing, onRefresh }) => {
  return (
    <FlatList
      data={skills}
      style={{ flex: 1 }}
      renderItem={({ item: skill, index }) => <SkillRow skill={skill} index={index} />}
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
            <ThemeToggle />
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
