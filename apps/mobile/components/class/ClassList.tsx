import { Link } from 'expo-router';
import { FC } from 'react';
import { FlatList } from 'react-native';
import { buttonTextVariants, buttonVariants } from '../atomics/button';
import { Text } from '../atomics/text';
import { useDimensions } from '@/hooks/useDimensions';
import { Class } from '@/types/class';

const ClassListItem: FC<{ classData: Class }> = ({ classData }) => {
  return (
    <Link
      style={{ marginVertical: 5 }}
      href={`/class/${classData.id}`}
      className={buttonVariants({ variant: 'outline' })}>
      <Text className={buttonTextVariants({ variant: 'outline' })}>{classData.title}</Text>
    </Link>
  );
};

export const ClassList: FC<{ data: Class[] }> = ({ data }) => {
  const { height } = useDimensions();
  return (
    <FlatList
      data={data}
      style={{ paddingHorizontal: 16, marginBottom: height / 2 }}
      renderItem={({ item: classData }) => <ClassListItem classData={classData} />}
      keyExtractor={(classData) => classData.id.toString()}
    />
  );
};
