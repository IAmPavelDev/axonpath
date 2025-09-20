import { Spinner } from '@/components/ui/spinner';
import { ClassById } from '@/types/class';
import rpc from '@/utils/rpc';
import { useQuery } from '@tanstack/react-query';
import { Tabs, useLocalSearchParams } from 'expo-router';
import React, { createContext, useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const ClassContext = createContext<ClassById | null>(null);

export function useClassData() {
  const context = useContext(ClassContext);
  if (!context) {
    throw new Error('useClassData must be used within a ClassProvider');
  }
  return context;
}

function CustomTabBar({ state, descriptors, navigation }) {
  return (
    <View style={styles.tabBarContainer}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = options.title !== undefined ? options.title : route.name;
        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            onPress={onPress}
            style={[styles.tabButton, isFocused && styles.tabButtonActive]}>
            <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ClassDetailsLayout() {
  const { classId } = useLocalSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['classById'],
    queryFn: () => rpc.class.get({ id: Number(classId) }),
  });

  if (isLoading || !data) {
    return <Spinner />;
  }

  return (
    <ClassContext.Provider value={data}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{data?.title}</Text>

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
});
