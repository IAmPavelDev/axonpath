import { Icon } from '@atomics/icon';
import { Text } from '@atomics/text';
import { formatDateLong, formatRelativeDate } from '@/lib/format';
import { track } from '@/lib/analytics';
import { Class } from '@/types/class';
import { Link } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { FC } from 'react';
import { Pressable, View } from 'react-native';

export const ClassListItem: FC<{ classData: Class; accuracy: number | null }> = ({
  classData,
  accuracy,
}) => {
  const activity = classData.lastActivityAt
    ? `Last studied ${formatRelativeDate(classData.lastActivityAt)}`
    : `Created ${formatRelativeDate(classData.createdAt)}`;
  const success =
    accuracy === null ? 'No answers yet' : `${Math.round(accuracy * 100)}% right`;
  return (
    <Link
      asChild
      href={`/class/${classData.id}`}
      onPress={() => {
        // How soon after generation does the learner open the lesson?
        void track('lesson_opened', {
          class_id: classData.id,
          seconds_since_created: Math.round(
            (Date.now() - new Date(classData.createdAt).getTime()) / 1000,
          ),
        });
      }}
    >
      <Pressable className="flex-row items-center gap-4 bg-background px-6 py-4 active:bg-accent">
        <View className="flex-1 gap-1">
          <Text numberOfLines={2} className="font-sans-medium text-[17px] leading-[24px]">
            {classData.title}
          </Text>
          <Text variant="meta">
            {success} · {activity}
          </Text>
        </View>
        <Icon as={ChevronRight} size={16} className="text-muted-foreground" strokeWidth={2} />
      </Pressable>
    </Link>
  );
};
