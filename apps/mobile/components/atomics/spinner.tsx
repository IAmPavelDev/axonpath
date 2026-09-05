import { useDimensions } from '@/hooks/useDimensions';
import { Loader } from 'lucide-react-native';
import { StyleSheet, View, Animated, Easing } from 'react-native';
import { useEffect, useRef } from 'react';

export const Spinner = () => {
  const { width, height } = useDimensions();
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, { width, height }]}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <Loader color="black" size={40} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});