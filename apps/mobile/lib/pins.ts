import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'axon.pinned-skills';

type PinsStore = {
  /** Skill ids the user pinned, in pin order. */
  pinnedIds: number[];
  hydrate: () => Promise<void>;
  toggle: (skillId: number) => void;
};

const persist = (ids: number[]) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids)).catch(() => {});
};

export const usePinnedSkills = create<PinsStore>((set, get) => ({
  pinnedIds: [],
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          set({ pinnedIds: parsed.filter((id): id is number => typeof id === 'number') });
        }
      }
    } catch {
      // Corrupted storage must not break the list; start empty.
    }
  },
  toggle: (skillId) => {
    const next = get().pinnedIds.includes(skillId)
      ? get().pinnedIds.filter((id) => id !== skillId)
      : [...get().pinnedIds, skillId];
    set({ pinnedIds: next });
    persist(next);
  },
}));
