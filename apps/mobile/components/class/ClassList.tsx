import { Link } from 'expo-router';
import { FC } from 'react';
import { buttonTextVariants, buttonVariants } from '../atomics/button';
import { Text } from '../atomics/text';
import { Class } from '@/types/class';

export const ClassListItem: FC<{ classData: Class }> = ({ classData }) => {
  return (
    <Link
      style={{ marginVertical: 5 }}
      href={`/class/${classData.id}`}
      className={buttonVariants({ variant: 'outline' })}>
      <Text className={buttonTextVariants({ variant: 'outline' })}>{classData.title}</Text>
    </Link>
  );
};