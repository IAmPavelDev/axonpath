import { Button } from '@atomics/button';
import { Icon } from '@atomics/icon';
import { Monitor, Moon, Sun } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { FC } from 'react';
import { useThemeMode, type ThemeMode } from '@/lib/theme-mode';

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const MODE_ICON = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;

const MODE_LABEL: Record<ThemeMode, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

/** Cycles system → light → dark. One control, whole-app effect. */
export const ThemeToggle: FC<{ className?: string }> = ({ className }) => {
  const mode = useThemeMode((s) => s.mode);
  const setMode = useThemeMode((s) => s.setMode);
  const { setColorScheme } = useColorScheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      accessibilityLabel={MODE_LABEL[mode]}
      onPress={() => {
        const next = NEXT_MODE[mode];
        setMode(next);
        setColorScheme(next);
      }}
      className={className}>
      <Icon as={MODE_ICON[mode]} size={20} strokeWidth={1.75} />
    </Button>
  );
};
