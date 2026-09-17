import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { cn } from '@/lib/utils';

/**
 * Monochrome live indicator (e.g. "AI is preparing"). The pulse is the
 * message; it deliberately carries no color.
 */
export function PulseDot({ className }: { className?: string }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.25,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }}>
      <View className={cn('size-1.5 rounded-full bg-foreground', className)} />
    </Animated.View>
  );
}
