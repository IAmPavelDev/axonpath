import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import rpc from '@/utils/rpc';
import { SkillList } from '@/components/skill/SkillList';
import { Skill } from '@/types/skill';
import { Spinner } from '@/components/atomics/spinner';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { Text } from '@/components/atomics/text';
import { Button } from '@/components/atomics/button';
import { useDimensions } from '@/hooks/useDimensions';

export default function Screen() {
  const { data: skills, isLoading, error } = useQuery<Skill[]>({
    queryKey: ['skillList'],
    queryFn: () => rpc.skill.list(),
  });

  return (
    <>
      {!isLoading && !skills?.length && <OpenCreateSkill />}
      {isLoading && <Spinner />}
      {!isLoading && skills && skills?.length > 0 && <SkillList skills={skills} />}
    </>
  );
}


const OpenCreateSkill = () => {
  const { screenHeight } = useDimensions();
  const router = useRouter();

  return (
    <View style={{ height: screenHeight, alignItems: 'center', justifyContent: 'center' }}>
      <Button
        style={{ width: 200, maxWidth: '70%', minWidth: 100 }}
        onPress={() => router.push('/skill/create')}>
        <Text style={{ fontSize: 20 }}>Learn skill +</Text>
      </Button>
    </View>
  );
}
