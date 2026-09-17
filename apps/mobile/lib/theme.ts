import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';

/**
 * Loaded font faces (see app/_layout.tsx). RN resolves weight through the
 * exact face name, so every consumer must pick the face explicitly instead
 * of relying on fontWeight.
 */
export const FONTS = {
  sansRegular: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  serifRegular: 'Newsreader_400Regular',
  serifMedium: 'Newsreader_500Medium',
  serifSemiBold: 'Newsreader_600SemiBold',
} as const;

export const THEME = {
  light: {
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(0 0% 9%)',
    card: 'hsl(0 0% 100%)',
    cardForeground: 'hsl(0 0% 9%)',
    popover: 'hsl(0 0% 100%)',
    popoverForeground: 'hsl(0 0% 9%)',
    primary: 'hsl(0 0% 9%)',
    primaryForeground: 'hsl(0 0% 98%)',
    secondary: 'hsl(0 0% 96%)',
    secondaryForeground: 'hsl(0 0% 9%)',
    muted: 'hsl(0 0% 96%)',
    mutedForeground: 'hsl(0 0% 45%)',
    accent: 'hsl(0 0% 94%)',
    accentForeground: 'hsl(0 0% 9%)',
    destructive: 'hsl(0 72% 46%)',
    destructiveForeground: 'hsl(0 0% 98%)',
    success: 'hsl(145 65% 27%)',
    successForeground: 'hsl(0 0% 98%)',
    border: 'hsl(0 0% 90%)',
    input: 'hsl(0 0% 90%)',
    ring: 'hsl(0 0% 64%)',
    radius: '0.625rem',
  },
  dark: {
    background: 'hsl(0 0% 0%)',
    foreground: 'hsl(0 0% 96%)',
    card: 'hsl(0 0% 8%)',
    cardForeground: 'hsl(0 0% 96%)',
    popover: 'hsl(0 0% 8%)',
    popoverForeground: 'hsl(0 0% 96%)',
    primary: 'hsl(0 0% 98%)',
    primaryForeground: 'hsl(0 0% 7%)',
    secondary: 'hsl(0 0% 14%)',
    secondaryForeground: 'hsl(0 0% 96%)',
    muted: 'hsl(0 0% 14%)',
    mutedForeground: 'hsl(0 0% 60%)',
    accent: 'hsl(0 0% 16%)',
    accentForeground: 'hsl(0 0% 96%)',
    destructive: 'hsl(0 65% 60%)',
    destructiveForeground: 'hsl(0 0% 7%)',
    success: 'hsl(142 55% 45%)',
    successForeground: 'hsl(0 0% 7%)',
    border: 'hsl(0 0% 15%)',
    input: 'hsl(0 0% 18%)',
    ring: 'hsl(0 0% 45%)',
    radius: '0.625rem',
  },
};

export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
