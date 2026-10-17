/**
 * System-engine fallback for conspect read-aloud (expo-speech). Used when
 * the bundled Kokoro engine fails to initialize or synthesize. Pausing on
 * Android stops the engine and re-speaking from the current word — the same
 * path seeking uses.
 */
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { findChunkForWord, localWordForChar, type SpeechPlan } from './word-map';

/** Fallback cadence for engines that never fire boundary events. */
const ESTIMATE_MS_PER_WORD = 340;
/** Grace window before deciding the engine gives no boundaries. */
const BOUNDARY_GRACE_MS = 1800;

/** BCP-47 tags device TTS engines accept for the hint languages; unknown
 * codes pass through untouched. */
const bcp47 = (lang: string): string => {
  const known: Record<string, string> = { en: 'en-US', uk: 'uk-UA', vi: 'vi-VN' };
  return known[lang] ?? lang;
};

export type SystemDriverHooks = {
  onWord: (globalWordIndex: number) => void;
  onPlaying: () => void;
  onDone: () => void;
  onFail: () => void;
};

export type SystemDriver = {
  start(plan: SpeechPlan, fromWord: number, until?: number): void;
  /** iOS pauses the engine; Android stops and re-speaks on resume. */
  pause(): void;
  resume(plan: SpeechPlan, fromWord: number, until?: number): void;
  stop(): void;
  dispose(): void;
};

export const createSystemDriver = (hooks: SystemDriverHooks): SystemDriver => {
  /** Bumped on every restart/stop; stale callbacks bail out. */
  let token = 0;
  /** Mapping for the utterance in flight: its first global word + local starts. */
  const spoken = { base: 0, starts: [] as number[] };
  /** Last word index handed to hooks — the estimate path increments it. */
  let lastWord = -1;
  let gotBoundary = false;
  let currentPlan: SpeechPlan | null = null;
  const timers: {
    grace?: ReturnType<typeof setTimeout>;
    estimate?: ReturnType<typeof setInterval>;
  } = {};

  const clearTimers = () => {
    clearTimeout(timers.grace);
    clearInterval(timers.estimate);
    timers.grace = undefined;
    timers.estimate = undefined;
  };

  const speakFrom = (plan: SpeechPlan, word: number, until = Number.POSITIVE_INFINITY) => {
    const current = ++token;
    currentPlan = plan;
    const chunk = findChunkForWord(plan, word);
    if (!chunk) {
      hooks.onDone();
      return;
    }
    const chunkIdx = plan.chunks.indexOf(chunk);
    const local = word - chunk.firstWord;
    const offset = chunk.starts[local] ?? 0;
    spoken.base = word;
    spoken.starts = chunk.starts.slice(local).map((s) => s - offset);
    lastWord = word;
    gotBoundary = false;
    clearTimers();
    Speech.stop();
    // The chunk's language picks the voice; untagged chunks keep the device
    // default so legacy lessons behave exactly as before.
    const language = chunk.lang ? bcp47(chunk.lang) : undefined;
    Speech.speak(chunk.text.slice(offset), {
      ...(language ? { language } : {}),
      onBoundary: (ev: { charIndex?: number }) => {
        if (current !== token || typeof ev.charIndex !== 'number') return;
        gotBoundary = true;
        const localIdx = localWordForChar({ ...chunk, starts: spoken.starts }, ev.charIndex);
        lastWord = spoken.base + localIdx;
        hooks.onWord(lastWord);
      },
      onDone: () => {
        if (current !== token || !currentPlan) return;
        const next = currentPlan.chunks[chunkIdx + 1];
        // `until` ends the current language run: past it, the orchestrator
        // chains the next run's engine.
        if (next && next.firstWord < until) speakFrom(currentPlan, next.firstWord, until);
        else hooks.onDone();
      },
      onError: () => {
        if (current !== token) return;
        hooks.onFail();
      },
    } as Speech.SpeechOptions);
    hooks.onPlaying();
    // Engines without boundary events (API < 26, odd OEM TTS): keep the
    // highlight moving on an estimate; a real boundary cancels it.
    timers.grace = setTimeout(() => {
      if (current !== token || gotBoundary) return;
      timers.estimate = setInterval(() => {
        lastWord = Math.min(lastWord + 1, Math.min(plan.words.length - 1, until - 1));
        hooks.onWord(lastWord);
      }, ESTIMATE_MS_PER_WORD);
    }, BOUNDARY_GRACE_MS);
  };

  return {
    start: (plan, fromWord, until) => speakFrom(plan, fromWord, until),
    pause: () => {
      clearTimers();
      if (Platform.OS === 'ios') Speech.pause();
      else Speech.stop();
    },
    resume: (plan, fromWord, until) => speakFrom(plan, fromWord, until),
    stop: () => {
      token++;
      clearTimers();
      Speech.stop();
    },
    dispose: () => {
      token++;
      clearTimers();
      Speech.stop();
    },
  };
};
