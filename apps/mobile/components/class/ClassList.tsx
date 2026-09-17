import { Link } from 'expo-router';
import { FC } from 'react';
import { Button, buttonTextVariants } from '@atomics/button';
import { Text } from '@atomics/text';
import { Class } from '@/types/class';

const formatDate = (date: Date) =>
  date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

export const ClassListItem: FC<{ classData: Class }> = ({ classData }) => {
  return (
    <Link asChild href={`/class/${classData.id}`}>
      <Button variant="outline" className="h-auto sm:h-auto flex-col items-start justify-start gap-1">
        <Text className={buttonTextVariants({ variant: 'outline' })}>{classData.title}</Text>
        <Text className="text-muted-foreground text-xs font-normal">
          {formatDate(classData.createdAt)}
        </Text>
      </Button>
    </Link>
  );
};
