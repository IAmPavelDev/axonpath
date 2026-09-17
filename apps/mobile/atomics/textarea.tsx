import { cn } from '@/lib/utils';
import { useDimensions } from '@hooks/useDimensions';
import {
  Platform,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { useState } from 'react';

const LINE_HEIGHT = 20;
const VERTICAL_PADDING = 12; // py-1 (2 * 4) + 2 * 1 border + slack
const MIN_ROWS = 3;

type TextareaProps = TextInputProps & React.RefAttributes<TextInput>;

function Textarea({ className, style, ...props }: TextareaProps) {
  const { screenHeight } = useDimensions();
  // Native multiline TextInput wraps content automatically; only web's
  // <textarea> needs JS-driven height.
  const [webHeight, setWebHeight] = useState(0);

  const minHeight = MIN_ROWS * LINE_HEIGHT + VERTICAL_PADDING;
  const maxHeight = Math.max(minHeight, Math.round(screenHeight * 0.7));

  const sizingStyle: TextStyle = Platform.select({
    web: {
      height: Math.max(minHeight, Math.min(webHeight || minHeight, maxHeight)),
    },
    default: { minHeight, maxHeight },
  }) as TextStyle;

  return (
    <TextInput
      {...(Platform.OS === 'web' ? ({ wrap: 'soft' } as const) : {})}
      {...props}
      multiline
      scrollEnabled
      textAlignVertical="top"
      className={cn(
        'dark:bg-input/30 border-input bg-background text-foreground w-full min-w-0 rounded-md border px-3 py-1 text-base leading-5 shadow-sm shadow-black/5',
        props.editable === false &&
          cn(
            'opacity-50',
            Platform.select({ web: 'disabled:pointer-events-none disabled:cursor-not-allowed' })
          ),
        Platform.select({
          web: cn(
            'selection:bg-primary selection:text-primary-foreground outline-none transition-[color,box-shadow] md:text-sm',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive'
          ),
          native: 'placeholder:text-muted-foreground/50',
        }),
        className
      )}
      style={[sizingStyle, style]}
      onContentSizeChange={(e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
        if (Platform.OS === 'web') {
          setWebHeight(e.nativeEvent.contentSize.height);
        }
        props.onContentSizeChange?.(e);
      }}
    />
  );
}

export { Textarea };