import { Icon } from '@atomics/icon';
import { Text } from '@atomics/text';
import { formatDateLong } from '@/lib/format';
import { Class } from '@/types/class';
import { Link } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { FC } from 'react';
import { Pressable, View } from 'react-native';

export const ClassListItem: FC<{ classData: Class }> = ({ classData }) => {
  return (
    <Link asChild href={`/class/${classData.id}`}>
      <Pressable className="flex-row items-center gap-4 bg-background px-6 py-4 active:bg-accent">
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={2} className="font-serif-medium text-[17px] leading-[24px]">
            {classData.title}
          </Text>
          <Text variant="meta">{formatDateLong(classData.createdAt)}</Text>
        </View>
        <Icon as={ChevronRight} size={16} className="text-muted-foreground" strokeWidth={2} />
      </Pressable>
    </Link>
  );
};
