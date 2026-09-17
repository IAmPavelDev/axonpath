import { useClassData } from './_layout';
import { ClassConspect } from '@components/class/ClassConspect';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

export default function Route() {
  const classData = useClassData();
  const { colorScheme } = useColorScheme();

  // Reading progress: a shared value keeps scroll → bar updates on the UI
  // thread with zero React re-renders.
  const progress = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    const max = Math.max(1, event.contentSize.height - event.layoutMeasurement.height);
    progress.value = Math.min(1, Math.max(0, event.contentOffset.y / max));
  });
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  return (
    <View className="flex-1">
      <View className="h-0.5 bg-muted">
        <Animated.View
          style={[
            {
              flex: 1,
              backgroundColor: THEME[colorScheme ?? 'light'].foreground,
              transformOrigin: 'left',
            },
            fillStyle,
          ]}
        />
      </View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 96 }}>
        <ClassConspect contentMd={classData.contentMd} />
      </Animated.ScrollView>
    </View>
  );
}
