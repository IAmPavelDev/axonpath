import {
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
  type KeyboardAvoidingViewProps,
} from 'react-native';

/**
 * KeyboardAvoidingView with the platform behavior preset: 'padding' on iOS
 * and Android, no-op on web.
 *
 * Android has to opt in explicitly: the app runs edge-to-edge (SDK 57), where
 * android:windowSoftInputMode="adjustResize" no longer resizes the window for
 * the soft keyboard — a bare KeyboardAvoidingView (behavior=undefined) is a
 * no-op and the keyboard covers the input. RN 0.86 reports correct IME
 * metrics under edge-to-edge, so 'padding' works on both native platforms
 * through one code path.
 */
function KeyboardAvoidingView({ behavior, ...props }: KeyboardAvoidingViewProps) {
  return (
    <RNKeyboardAvoidingView
      {...props}
      behavior={behavior ?? (Platform.OS === 'web' ? undefined : 'padding')}
    />
  );
}

export { KeyboardAvoidingView };
