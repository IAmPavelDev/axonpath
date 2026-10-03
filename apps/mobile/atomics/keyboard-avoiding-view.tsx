import {
  Keyboard,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
  View,
  type KeyboardAvoidingViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';

/**
 * KeyboardAvoidingView with the platform behavior preset: 'padding' on iOS,
 * no-op on web.
 *
 * Android gets a custom path. The stock RN KeyboardAvoidingView derives the
 * overlap from `endCoordinates.screenY`, which RN 0.86 reads from
 * getWindowVisibleDisplayFrame. Under edge-to-edge that frame does not shrink
 * for the IME below Android 15, so screenY lands at the window bottom, the
 * overlap computes to 0 and the view never moves (RN's 0.86 notes only claim
 * KAV support on Android 15+).
 *
 * The `height` in the very same event is reliable on Android 11+ (WindowInsets
 * ime() minus the nav bar), so the Android path pads by that height while the
 * keyboard is up. Every usage here is a flex:1 screen root or bottom tab area,
 * so the keyboard always overlaps the view by its full height and the stock
 * overlap geometry adds nothing. The event height excludes the nav bar inset
 * the keyboard covers, so the bar is restored on top.
 */
function KeyboardAvoidingView(props: KeyboardAvoidingViewProps) {
  if (Platform.OS === 'android') {
    return <AndroidKeyboardAvoidingView {...props} />;
  }
  return (
    <RNKeyboardAvoidingView
      {...props}
      behavior={props.behavior ?? (Platform.OS === 'web' ? undefined : 'padding')}
    />
  );
}

function AndroidKeyboardAvoidingView({
  enabled = true,
  style,
  ...props
}: KeyboardAvoidingViewProps) {
  const insets = useSafeAreaInsets();
  const [bottom, setBottom] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const showListener = Keyboard.addListener('keyboardDidShow', (event) => {
      setBottom(event.endCoordinates.height + insets.bottom);
    });
    const hideListener = Keyboard.addListener('keyboardDidHide', () => setBottom(0));
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, [enabled, insets.bottom]);

  return <View {...props} style={[style, { paddingBottom: bottom }]} />;
}

export { KeyboardAvoidingView };
