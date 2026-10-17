import type { SpeechStatus } from '@/hooks/use-conspect-speech';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { Pause, Play } from 'lucide-react-native';
import type { FC } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';

/**
 * Circular play/pause pill floating directly above the "Ask AI" button.
 * Starts/resumes/pauses the local read-aloud of the conspect.
 */
export const ConspectPlayButton: FC<{
  status: SpeechStatus;
  onPress: () => void;
}> = ({ status, onPress }) => {
  const { colorScheme } = useColorScheme();
  const ink = THEME[colorScheme ?? 'light'];
  const busy = status === 'loading';
  const Icon = status === 'playing' ? Pause : Play;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={status === 'playing' ? 'Pause reading the lesson' : 'Read the lesson aloud'}
      className="absolute bottom-[74px] right-5 h-12 w-12 items-center justify-center rounded-full bg-primary active:opacity-80"
      style={{ elevation: 6 }}>
      {busy ? (
        <ActivityIndicator size="small" color={ink.primaryForeground} />
      ) : (
        <Icon size={18} color={ink.primaryForeground} fill={ink.primaryForeground} />
      )}
    </Pressable>
  );
};
