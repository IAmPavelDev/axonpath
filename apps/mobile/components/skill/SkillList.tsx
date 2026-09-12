import { Skill } from '@/types/skill';
import { Link, useRouter } from 'expo-router';
import { FC } from 'react';
import { FlatList, View } from 'react-native';
import { Button, buttonTextVariants, buttonVariants } from '@atomics/button';
import { Text } from '@atomics/text';

const OpenCreateSkillButton: FC = () => {
  const router = useRouter();
  return (
    <Button
      style={{ width: 200, maxWidth: '70%', minWidth: 100, marginVertical: 5 }}
      onPress={() => router.push('/skill/create')}>
      <Text style={{ fontSize: 20 }}>Learn skill +</Text>
    </Button>
  );
};

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
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingTop: 4 }}>
      <OpenCreateSkillButton />
      <FlatList
        data={skills}
        style={{
          flex: 1,
          alignSelf: 'stretch',
          paddingHorizontal: 16,
          marginTop: 4,
          marginBottom: 20,
        }}
        renderItem={({ item: skill, index }) => <SkillListItem skill={skill} />}
        keyExtractor={skill => skill.id.toString()}
      />
    </View>
  );
};
