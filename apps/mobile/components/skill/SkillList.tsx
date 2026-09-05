import { Skill } from '@/types/skill';
import { Link } from 'expo-router';
import { FC, Fragment } from 'react';
import { FlatList } from 'react-native';
import { buttonTextVariants, buttonVariants } from '../atomics/button';
import { Separator } from '../atomics/separator';
import { Text } from '../atomics/text';
import { useDimensions } from '@/hooks/useDimensions';

const SkillListItem: FC<{ skill: Skill }> = ({ skill }) => {
  return (
    <Link
      style={{ marginVertical: 5 }}
      href={`/skill/${skill.id}`}
      className={buttonVariants({ variant: 'outline' })}>
      <Text className={buttonTextVariants({ variant: 'outline' })}>{skill.topic}</Text>
    </Link>
  );
};

export const SkillList: FC<{ skills: Skill[] }> = ({ skills }) => {
  const { height } = useDimensions();
  return (
    <FlatList
      data={skills}
      style={{ paddingHorizontal: 16, marginBottom: height / 2 }}
      renderItem={({ item: skill }) => <SkillListItem skill={skill} />}
      keyExtractor={(skill) => skill.id.toString()}
    />
  );
};
