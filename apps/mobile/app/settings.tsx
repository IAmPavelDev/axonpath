import { SegmentedControl } from '@atomics/segmented-control';
import { ScreenHeader } from '@components/screen-header';
import { Text } from '@atomics/text';
import { useThemeMode, type ThemeMode } from '@/lib/theme-mode';
import { useColorScheme } from 'nativewind';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const mode = useThemeMode((s) => s.mode);
  const setMode = useThemeMode((s) => s.setMode);

  // 'system' follows the OS until the user picks a side; the switch shows
  // the side currently in effect.
  const effective: ThemeMode = mode === 'system' ? (colorScheme ?? 'light') : mode;

  return (
    <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
      <ScreenHeader title="Settings" onBack={() => router.back()} />

      <Text variant="label" className="px-6 pb-2 pt-4">
        Appearance
      </Text>
      <View className="px-4">
        <SegmentedControl
          options={THEME_OPTIONS}
          value={effective}
          onChange={(next) => setMode(next)}
        />
        <Text variant="muted" className="px-2 pt-2.5">
          Leave it untouched and Axon follows your system until you pick a side.
        </Text>
      </View>

      <View className="flex-1" />

      <Text variant="meta" className="pb-6 text-center">
        Axon {Constants.expoConfig?.version ?? ''}
      </Text>
    </View>
  );
}
