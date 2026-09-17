import { useColorScheme } from 'nativewind';
import { Loader } from 'lucide-react-native';
import { StyleSheet, View, Animated, Easing } from 'react-native';
import { useEffect, useRef } from 'react';

export const Spinner = () => {
  const { colorScheme } = useColorScheme();
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <Loader color={colorScheme === 'dark' ? 'white' : 'black'} size={28} strokeWidth={1.75} />
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
