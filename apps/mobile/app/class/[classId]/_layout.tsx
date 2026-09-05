import React, { createContext, useContext, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, useLocalSearchParams } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';

import { Spinner } from '@/components/atomics/spinner';
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

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.tabBarContainer}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label =
          options.title !== undefined
            ? options.title
            : route.name;

        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            // The BottomTabBarProps navigation is untyped for route names here, so cast is common.
            navigation.navigate(route.name as never);
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            onPress={onPress}
            style={[styles.tabButton, isFocused && styles.tabButtonActive]}
          >
            <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ClassDetailsLayout() {
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
      <View style={styles.center}>
        <Text style={styles.errorText}>Invalid or missing classId.</Text>
      </View>
    );
  }

  if (isLoading || !data) {
    return <Spinner />;
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load class: {error?.message ?? 'Unknown error'}</Text>
      </View>
    );
  }

  return (
    <ClassContext.Provider value={data}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{data.title}</Text>

        <Tabs tabBar={(props) => <CustomTabBar {...props} />}>
          <Tabs.Screen
            name="index"
            options={{
              title: 'Conspect',
              headerShown: false,
            }}
          />
          <Tabs.Screen
            name="quiz"
            options={{
              title: 'Quiz',
              headerShown: false,
            }}
          />
        </Tabs>
      </View>
    </ClassContext.Provider>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingVertical: 16,
  },
  tabBarContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#fff',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tabButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    flex: 1,
  },
  tabButtonActive: {
    backgroundColor: 'black',
  },
  tabLabel: {
    fontSize: 16,
    color: 'black',
    fontWeight: '500',
    textAlign: 'center',
  },
  tabLabelActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  errorText: {
    color: '#b00020',
    textAlign: 'center',
  },
});
