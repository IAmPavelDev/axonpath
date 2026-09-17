import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'axon.theme-mode';

type ThemeModeStore = {
  /** User-facing preference. Defaults to following the OS. */
  mode: ThemeMode;
  /** Load the persisted preference once at launch. */
  hydrate: () => Promise<void>;
  setMode: (mode: ThemeMode) => void;
};

export const useThemeMode = create<ThemeModeStore>((set) => ({
  mode: 'system',
  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        set({ mode: stored });
      }
    } catch {
      // Unreadable storage must not block startup; keep 'system'.
    }
  },
  setMode: (mode) => {
    set({ mode });
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  },
}));
