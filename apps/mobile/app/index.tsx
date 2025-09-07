import React, { useEffect, useState } from 'react';
import { Text, TextInput, Pressable } from 'react-native';
import rpc from '@/utils/rpc';

export default function Screen() {
  const [state, setState] = useState('');

  return (
    <>
      <Text>Hello  {state}</Text>
      <TextInput onChangeText={setState} value={state} />
      <Pressable onPress={() => rpc.skill.create({ topic: state })}>
        <Text>Create skill</Text>
      </Pressable>
    </>
  );
}
