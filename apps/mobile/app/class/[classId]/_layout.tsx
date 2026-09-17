import React, { createContext, useContext, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Tabs, useLocalSearchParams, useRouter } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';

import { Skeleton } from '@atomics/skeleton';
import { Text } from '@atomics/text';
import { ScreenHeader } from '@components/screen-header';
import { cn } from '@/lib/utils';
import type { ClassById } from '@/types/class';
import rpc from '@/utils/rpc';

type ClassContextValue = ClassById;

const ClassContext = createContext<ClassContextValue | undefined>(undefined);

export function useClassData(): ClassContextValue {
  const context = useContext(ClassContext);
  if (!context) {
    throw new Error('useClassData must be used within a ClassProvider');
  }
  return context;
}

/**
 * iOS-style segmented control standing in for the tab bar. `muted` is the
 * resting track; the active segment lifts out as `background` — the only
 * signal needed to read which surface you are on.
 */
function SegmentedTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View className="border-hairline border-border px-4 pb-2.5 pt-1">
      <View className="flex-row rounded-lg bg-muted p-0.5">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = options.title !== undefined ? options.title : route.name;
          const isFocused = state.index === index;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name as never);
                }
              }}
              className="flex-1">
              <View
                className={cn(
                  'h-9 items-center justify-center rounded-md',
                  isFocused ? 'bg-background' : 'active:bg-accent'
                )}>
                <Text
                  className={cn(
                    'text-[13px]',
                    isFocused ? 'font-sans-semibold text-foreground' : 'text-muted-foreground'
                  )}>
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function ClassDetailsLayout() {
  const router = useRouter();
  const params = useLocalSearchParams<{ classId?: string | string[] }>();

  const classIdNum = useMemo(() => {
    const idStr = Array.isArray(params.classId) ? params.classId?.[0] : params.classId;
    const n = Number(idStr);
    return Number.isFinite(n) ? n : undefined;
  }, [params.classId]);

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery<ClassById, Error>({
    queryKey: ['classById', classIdNum],
    queryFn: () => rpc.class.get({ id: classIdNum! }),
    enabled: classIdNum !== undefined,
    staleTime: 60_000,
  });

  if (classIdNum === undefined) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text variant="muted">Invalid or missing class id.</Text>
      </View>
    );
  }

  if (isLoading || !data) {
    return (
      <View className="flex-1 px-6 pt-10">
        <Skeleton className="mb-2 h-6 w-3/4 rounded-md" />
        <Skeleton className="h-6 w-1/2 rounded-md" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text variant="muted">Failed to load class: {error?.message ?? 'Unknown error'}</Text>
      </View>
    );
  }

  return (
    <ClassContext.Provider value={data}>
      <View className="flex-1">
        <View className="px-6 pb-4 pt-1">
          <ScreenHeader onBack={() => router.back()} className="-mx-3" />
          <Text numberOfLines={3} className="font-serif-medium text-[24px] leading-[30px] tracking-tight">
            {data.title}
          </Text>
        </View>
        <Tabs
          tabBar={(props) => <SegmentedTabBar {...props} />}
          screenOptions={{ tabBarPosition: 'top', headerShown: false }}>
          <Tabs.Screen name="index" options={{ title: 'Conspect' }} />
          <Tabs.Screen name="quiz" options={{ title: 'Quiz' }} />
        </Tabs>
      </View>
    </ClassContext.Provider>
  );
}
