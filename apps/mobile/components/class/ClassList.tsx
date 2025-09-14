import { Link } from 'expo-router';
import { FC } from 'react';
import { FlatList } from 'react-native';
import { buttonTextVariants, buttonVariants } from '../ui/button';
import { Text } from '../ui/text';
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

export const ClassList: FC<{ classesData: Class[] }> = ({ classesData }) => {
  const { height } = useDimensions();
  return (
    <FlatList
      data={classesData}
      style={{ paddingHorizontal: 16, marginBottom: height / 2 }}
      renderItem={({ item: classData }) => <ClassListItem classData={classData} />}
      keyExtractor={(classData) => classData.id.toString()}
    />
  );
};
