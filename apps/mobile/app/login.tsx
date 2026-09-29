import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { firebaseAuth, firebaseConfigMissing } from '@/lib/firebase';
import { getGoogleSignin, googleSignInConfigured } from '@/lib/google-signin';
import { Button } from '@atomics/button';
import { Input } from '@atomics/input';
import { Text } from '@atomics/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Firebase error codes users actually hit → short, honest copy. */
const AUTH_ERRORS: Record<string, string> = {
  'auth/email-already-in-use': 'That email already has an account — sign in instead.',
  'auth/invalid-email': 'That email address looks wrong.',
  'auth/weak-password': 'Use at least 6 characters for your password.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts — try again in a bit.',
  'auth/network-request-failed': 'Network error — check your connection.',
  'auth/invalid-api-key': 'Firebase is misconfigured — check the API key.',
};

const describeAuthError = (code: string, fallback: string): string =>
  AUTH_ERRORS[code] ?? fallback;

type Mode = 'signin' | 'signup';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('signin');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'form' | 'google' | null>(null);

  const submitForm = async () => {
    if (busy) return;
    setError(null);

    if (firebaseAuth === null || firebaseConfigMissing) {
      setError('Firebase is not configured yet — see FIREBASE_SETUP.md.');
      return;
    }

    setBusy('form');
    try {
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(
          firebaseAuth,
          email.trim(),
          password,
        );
        const displayName = [firstName.trim(), lastName.trim()]
          .filter(Boolean)
          .join(' ');
        if (displayName.length > 0) {
          await updateProfile(credential.user, { displayName });
        }
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      }
      // onIdTokenChanged flips the auth store; the root layout swaps screens.
      router.replace('/');
    } catch (err) {
      const code = err instanceof Object && 'code' in err ? String(err.code) : '';
      setError(describeAuthError(code, 'Something went wrong — try again.'));
    } finally {
      setBusy(null);
    }
  };

  const continueWithGoogle = async () => {
    if (busy) return;
    setError(null);

    // Expo Go cannot host the native module — that is the accurate blocker;
    // the web client ID only matters once a dev build exists.
    const googleSignin = getGoogleSignin();
    if (!googleSignin) {
      setError(
        'Google sign-in needs a development build — Expo Go cannot host it (see FIREBASE_SETUP.md).',
      );
      return;
    }
    if (!googleSignInConfigured()) {
      setError(
        'Google sign-in is not configured yet — see FIREBASE_SETUP.md (missing web client ID).',
      );
      return;
    }

    setBusy('google');
    try {
      // No-op (true) on iOS; prompts to install/update Play services on Android.
      await googleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await googleSignin.signIn();
      if (response.type !== 'success') return; // user closed the picker
      const idToken = response.data.idToken;
      if (!idToken) {
        setError('Google did not return a token — try again.');
        return;
      }
      if (firebaseAuth === null) return;
      await signInWithCredential(
        firebaseAuth,
        GoogleAuthProvider.credential(idToken),
      );
      // onIdTokenChanged flips the auth store; the root layout swaps screens.
      router.replace('/');
    } catch (err) {
      const code = err instanceof Object && 'code' in err ? String(err.code) : '';
      setError(
        describeAuthError(code, `Google sign-in failed (${code || 'unknown'}) — try again.`),
      );
    } finally {
      setBusy(null);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ paddingBottom: insets.bottom }}>
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-8"
        keyboardShouldPersistTaps="handled">
        <View className="gap-1.5 pb-10">
          <Text className="font-sans-medium text-[28px] leading-[34px] tracking-tight">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text variant="muted">
            {mode === 'signin'
              ? 'Sign in to keep learning where you left off.'
              : 'Name any topic — Axon builds the first lesson.'}
          </Text>
        </View>

        <View className="gap-3">
          {mode === 'signup' && (
            <View className="flex-row gap-3">
              <View className="flex-1 gap-1.5">
                <Text variant="label">First name</Text>
                <Input
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Grace"
                  autoCapitalize="words"
                  textContentType="givenName"
                />
              </View>
              <View className="flex-1 gap-1.5">
                <Text variant="label">Last name</Text>
                <Input
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Hopper"
                  autoCapitalize="words"
                  textContentType="familyName"
                />
              </View>
            </View>
          )}

          <View className="gap-1.5">
            <Text variant="label">Email</Text>
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
            />
          </View>

          <View className="gap-1.5">
            <Text variant="label">Password</Text>
            <Input
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoComplete="password"
              textContentType={mode === 'signup' ? 'newPassword' : 'password'}
            />
          </View>

          {error && <Text className="text-destructive">{error}</Text>}

          <Button
            size="lg"
            className="mt-2"
            disabled={busy !== null || email.length === 0 || password.length === 0}
            onPress={submitForm}>
            <Text>{busy === 'form' ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
          </Button>

          <View className="flex-row items-center gap-3 py-2">
            <View className="h-px flex-1 bg-border" />
            <Text variant="meta">or</Text>
            <View className="h-px flex-1 bg-border" />
          </View>

          <Button
            variant="outline"
            size="lg"
            disabled={busy !== null}
            onPress={continueWithGoogle}>
            <Text>
              {busy === 'google' ? 'Connecting…' : 'Continue with Google'}
            </Text>
          </Button>

          <Pressable
            accessibilityRole="button"
            className="py-3"
            disabled={busy !== null}
            onPress={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
            <Text variant="muted" className="text-center">
              {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
              <Text className="text-foreground">
                {mode === 'signin' ? 'Create an account' : 'Sign in'}
              </Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
