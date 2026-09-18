import '@/global.css';

import React, { useEffect, useState } from 'react';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import {
  Newsreader_400Regular,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
} from '@expo-google-fonts/newsreader';
import * as SplashScreen from 'expo-splash-screen';
import { NAV_THEME } from '@/lib/theme';
import { useThemeMode } from '@/lib/theme-mode';
import { useAuthStore } from '@/store/auth.store';
import { Appearance, Platform } from 'react-native';
import { ThemeProvider } from "expo-router/react-navigation";
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

const queryClient = new QueryClient();

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { setColorScheme } = useColorScheme();
  const mode = useThemeMode((s) => s.mode);
  const hydrate = useThemeMode((s) => s.hydrate);
  const authStatus = useAuthStore((s) => s.status);
  const initAuth = useAuthStore((s) => s.init);

  // 'system' must resolve to a concrete scheme so NativeWind's JS state and
  // its CSS variables can never disagree. RN 0.86 can report 'unspecified'
  // (Android 15+); it means "no preference" → light.
  const [systemScheme, setSystemScheme] = useState<'light' | 'dark'>(
    () => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'),
  );

  useEffect(() => {
    const subscription = Appearance.addChangeListener((preferences) => {
      setSystemScheme(preferences.colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => subscription.remove();
  }, []);

  const resolvedScheme: 'light' | 'dark' =
    mode === 'system' ? systemScheme : mode;

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Newsreader_400Regular,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
  });

  // Firebase's native observer: resolves persisted sessions and token
  // refreshes; the status it reports drives the route guards below.
  useEffect(() => {
    return initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (fontsLoaded && authStatus !== 'initializing') {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, authStatus]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setColorScheme(resolvedScheme);
    // NativeWind's runtime manages the class on native; on web the CSS
    // variables are class-driven, so keep <html> in sync ourselves.
    if (Platform.OS === 'web') {
      document.documentElement.classList.toggle('dark', resolvedScheme === 'dark');
    }
  }, [resolvedScheme, setColorScheme]);

  if (!fontsLoaded || authStatus === 'initializing') {
    return null;
  }


  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={NAV_THEME[resolvedScheme]}>
            <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Protected guard={authStatus === 'signedIn'}>
                <Stack.Screen name="index" />
                <Stack.Screen name="skill" />
                <Stack.Screen name="class" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="+not-found" />
              </Stack.Protected>
              <Stack.Protected guard={authStatus === 'signedOut'}>
                <Stack.Screen name="login" />
              </Stack.Protected>
            </Stack>
            <PortalHost />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
