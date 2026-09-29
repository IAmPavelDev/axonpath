import { DarkTheme, DefaultTheme, type Theme } from "expo-router/react-navigation";

/**
 * Loaded font faces (see app/_layout.tsx). RN resolves weight through the
 * exact face name, so every consumer must pick the face explicitly instead
 * of relying on fontWeight.
 */
export const FONTS = {
  sansRegular: 'SourceSans3_400Regular',
  sansMedium: 'SourceSans3_500Medium',
  sansSemiBold: 'SourceSans3_600SemiBold',
  sansBold: 'SourceSans3_700Bold',
} as const;

export const THEME = {
  light: {
    background: 'hsl(213 45% 95%)',
    foreground: 'hsl(221 39% 11%)',
    card: 'hsl(0 0% 100%)',
    cardForeground: 'hsl(221 39% 11%)',
    popover: 'hsl(0 0% 100%)',
    popoverForeground: 'hsl(221 39% 11%)',
    primary: 'hsl(221 83% 50%)',
    primaryForeground: 'hsl(0 0% 100%)',
    secondary: 'hsl(213 32% 93%)',
    secondaryForeground: 'hsl(221 39% 11%)',
    muted: 'hsl(213 32% 93%)',
    mutedForeground: 'hsl(215 19% 35%)',
    accent: 'hsl(213 36% 90%)',
    accentForeground: 'hsl(221 39% 11%)',
    destructive: 'hsl(0 72% 46%)',
    destructiveForeground: 'hsl(0 0% 98%)',
    success: 'hsl(145 65% 27%)',
    successForeground: 'hsl(0 0% 98%)',
    border: 'hsl(213 25% 84%)',
    input: 'hsl(213 28% 80%)',
    ring: 'hsl(217 91% 60%)',
    radius: '0.625rem',
  },
  dark: {
    // "Lifted navy" — dark mode sits around 12% lightness with a clear
    // blue cast (the slate-800/900 family), unmistakably blue rather than
    // black-ish. The whole surface scale (card → secondary/muted → accent
    // → border/input) climbs coherently from the background so layering
    // still reads; primary is the brighter educational blue (blue-400
    // family) carrying dark navy ink on it, Material-dark style.
    background: 'hsl(221 39% 12%)',
    foreground: 'hsl(217 24% 90%)',
    card: 'hsl(220 32% 17%)',
    cardForeground: 'hsl(217 24% 90%)',
    popover: 'hsl(220 32% 17%)',
    popoverForeground: 'hsl(217 24% 90%)',
    primary: 'hsl(213 94% 68%)',
    primaryForeground: 'hsl(221 39% 10%)',
    secondary: 'hsl(220 27% 21%)',
    secondaryForeground: 'hsl(217 24% 90%)',
    muted: 'hsl(220 27% 21%)',
    mutedForeground: 'hsl(216 16% 70%)',
    accent: 'hsl(220 25% 25%)',
    accentForeground: 'hsl(217 24% 90%)',
    destructive: 'hsl(0 65% 60%)',
    destructiveForeground: 'hsl(221 39% 10%)',
    success: 'hsl(142 55% 45%)',
    successForeground: 'hsl(221 39% 10%)',
    border: 'hsl(220 18% 26%)',
    input: 'hsl(220 17% 29%)',
    ring: 'hsl(213 94% 68%)',
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
