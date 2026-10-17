/**
 * System-engine fallback for conspect read-aloud (expo-speech). Used when
 * the bundled Kokoro engine fails to initialize or synthesize. Pausing on
 * Android stops the engine and re-speaking from the current word — the same
 * path seeking uses.
 */
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { findChunkForWord, localWordForChar, type SpeechPlan } from './word-map';

/** English-only for now; per-class language arrives when classes carry one. */
const SPEECH_LANGUAGE = 'en-US';
/** Fallback cadence for engines that never fire boundary events. */
const ESTIMATE_MS_PER_WORD = 340;
/** Grace window before deciding the engine gives no boundaries. */
const BOUNDARY_GRACE_MS = 1800;

export type SystemDriverHooks = {
  onWord: (globalWordIndex: number) => void;
  onPlaying: () => void;
  onDone: () => void;
  onFail: () => void;
};

export type SystemDriver = {
  start(plan: SpeechPlan, fromWord: number): void;
  /** iOS pauses the engine; Android stops and re-speaks on resume. */
  pause(): void;
  resume(plan: SpeechPlan, fromWord: number): void;
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

  const speakFrom = (plan: SpeechPlan, word: number) => {
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
    Speech.speak(chunk.text.slice(offset), {
      language: SPEECH_LANGUAGE,
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
        if (next) speakFrom(currentPlan, next.firstWord);
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
        lastWord = Math.min(lastWord + 1, plan.words.length - 1);
        hooks.onWord(lastWord);
      }, ESTIMATE_MS_PER_WORD);
    }, BOUNDARY_GRACE_MS);
  };

  return {
    start: (plan, fromWord) => speakFrom(plan, fromWord),
    pause: () => {
      clearTimers();
      if (Platform.OS === 'ios') Speech.pause();
      else Speech.stop();
    },
    resume: (plan, fromWord) => speakFrom(plan, fromWord),
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
