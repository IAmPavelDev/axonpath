import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import rpc from '@/utils/rpc';
import { SkillList } from '@/components/skill/SkillList';
import { Skill } from '@/types/skill';

export default function Screen() {
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    rpc.skill.list().then((res) => {
      setSkills(res);
    });
  }, []);

  return (
      <SkillList skills={skills} />
  );
}
