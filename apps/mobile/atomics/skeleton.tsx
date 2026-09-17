import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';
import { Animated, Easing, View, ViewStyle } from 'react-native';

/**
 * Content-shaped loading placeholder. The pulse is deliberately slow and
 * monochrome: it reads as "loading", never as decoration.
 */
export function Skeleton({ className, style }: { className?: string; style?: ViewStyle }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View style={[{ opacity: pulse }, style]}>
      <View className={cn('rounded-md bg-muted', className)} />
    </Animated.View>
  );
}
