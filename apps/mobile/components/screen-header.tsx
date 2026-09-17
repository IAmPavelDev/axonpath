import { Button } from '@atomics/button';
import { Icon } from '@atomics/icon';
import { Text } from '@atomics/text';
import { ChevronLeft } from 'lucide-react-native';
import { FC, ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Compact navigation bar: back affordance on the left, one-line title,
 * optional right action slot. Screens with editorial headers (Library,
 * Class) build their own composition instead.
 */
export const ScreenHeader: FC<{
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
  className?: string;
}> = ({ title, onBack, right, className }) => {
  return (
    <View className={`h-14 flex-row items-center gap-1 px-3 ${className ?? ''}`}>
      {onBack && (
        <Button variant="ghost" size="icon" accessibilityLabel="Back" onPress={onBack}>
          <Icon as={ChevronLeft} size={24} strokeWidth={2} />
        </Button>
      )}
      {title && (
        <Text numberOfLines={1} className="font-sans-semibold text-[17px]">
          {title}
        </Text>
      )}
      <View className="flex-1" />
      {right}
    </View>
  );
};
