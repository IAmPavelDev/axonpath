import { Button } from '@atomics/button';
import { Text } from '@atomics/text';
import { Link, Stack } from 'expo-router';
import { View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View className="flex-1 items-center justify-center gap-5 px-10">
        <Text className="text-center font-sans-medium text-[24px] leading-[30px] tracking-tight">
          This page doesn't exist.
        </Text>
        <Link asChild href="/">
          <Button variant="outline">
            <Text>Back to Library</Text>
          </Button>
        </Link>
      </View>
    </>
  );
}
