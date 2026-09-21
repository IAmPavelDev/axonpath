import { Text as RNText } from 'react-native';
import { THEME, FONTS } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { Pressable, StyleSheet, View } from 'react-native';

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * iOS-style segmented control (bisect build: raw StyleSheet, no
 * NativeWind classes) — isolating whether a css-interop class breaks
 * pressability inside navigator screens on Android.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colorScheme } = useColorScheme();
  const t = THEME[colorScheme ?? 'light'];

  return (
    <View style={[styles.track, { backgroundColor: t.muted }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={active ? { selected: true } : {}}
            onPress={() => onChange(option.value)}
            style={[
              styles.chip,
              active
                ? { backgroundColor: t.background, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border }
                : { borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
            ]}>
            <RNText
              style={[
                styles.label,
                { color: active ? t.foreground : t.mutedForeground, fontFamily: active ? FONTS.sansSemiBold : FONTS.sansRegular },
              ]}>
              {option.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 2,
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    minHeight: 36,
  },
  label: {
    fontSize: 13,
  },
});
