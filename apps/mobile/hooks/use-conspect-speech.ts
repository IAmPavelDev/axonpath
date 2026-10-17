import { KokoroDriver } from '@/lib/conspect-speech/kokoro';
import {
  buildLangRuns,
  buildSpeechPlan,
  stripLeadingH1,
} from '@/lib/conspect-speech/word-map';
import { createSystemDriver, type SystemDriver } from '@/lib/conspect-speech/system-driver';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'done';

type DriverHooks = {
  onWord: (index: number) => void;
  onLoading: () => void;
  onPlaying: () => void;
  onDone: () => void;
  onFail: () => void;
};

/**
 * Drives conspect read-aloud. The plan splits into language runs: English
 * chunks play on the bundled Kokoro-82M engine (on-device, offline), every
 * other language on the system engine (expo-speech) with the chunk language
 * as a voice hint. Runs chain through onDone. If Kokoro fails to initialize
 * or synthesize, the whole session degrades to the system engine. Both
 * engines report the word currently being spoken, which the highlight
 * renderer and the scroll-follow consume.
 */
export function useConspectSpeech(
  contentMd: string | null,
  enabled: boolean,
  baseLanguage?: string | null,
) {
  const plan = useMemo(
    () => buildSpeechPlan(stripLeadingH1(contentMd ?? ''), baseLanguage),
    [contentMd, baseLanguage],
  );
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [wordIndex, setWordIndex] = useState(-1);

  const planRef = useRef(plan);
  planRef.current = plan;
  const statusRef = useRef(status);
  statusRef.current = status;
  const wordIndexRef = useRef(wordIndex);
  wordIndexRef.current = wordIndex;
  /** Set once Kokoro has failed; every run then plays on the system engine. */
  const useSystemRef = useRef(false);
  /** Engine owning the run in flight (pause targeting). */
  const activeKokoroRef = useRef(false);
  const startRunRef = useRef<(fromWord: number) => void>(undefined);

  const hooks = useMemo<DriverHooks>(
    () => ({
      onWord: (index) => setWordIndex(index),
      onLoading: () => setStatus('loading'),
      onPlaying: () => setStatus('playing'),
      onDone: () => {
        // A run finished: chain the next one, starting after the last word
        // reported. Position-based, so run merges can never skip a chunk.
        const from = wordIndexRef.current + 1;
        const runs = buildLangRuns(planRef.current, useSystemRef.current);
        const next = runs.find((r) => from < r.until);
        if (next) {
          startRunRef.current?.(Math.max(next.from, from));
          return;
        }
        setStatus('done');
        setWordIndex(-1);
      },
      onFail: () => {
        setStatus('idle');
        setWordIndex(-1);
      },
    }),
    [],
  );

  const kokoroRef = useRef<KokoroDriver | null>(null);
  const systemRef = useRef<SystemDriver | null>(null);

  const stop = useCallback(() => {
    kokoroRef.current?.stop();
    systemRef.current?.stop();
    setStatus('idle');
    setWordIndex(-1);
  }, []);

  /** Plays the run containing `fromWord`; runs chain through hooks.onDone. */
  const startRun = useCallback(
    (fromWord: number) => {
      const runs = buildLangRuns(planRef.current, useSystemRef.current);
      const run = runs.find((r) => fromWord >= r.from && fromWord < r.until);
      if (!run) {
        hooks.onDone();
        return;
      }
      const useKokoro = run.engine === 'kokoro' && !useSystemRef.current;
      activeKokoroRef.current = useKokoro;
      void (async () => {
        try {
          const driver = useKokoro
            ? (kokoroRef.current ??= new KokoroDriver(hooks))
            : (systemRef.current ??= createSystemDriver(hooks));
          await driver.start(planRef.current, fromWord, run.until);
        } catch (err) {
          if (!useKokoro) {
            hooks.onFail();
            return;
          }
          // Kokoro unavailable (init or synthesis failure) → degrade to the
          // system engine for the rest of the session. The warning is the
          // logcat fingerprint of a missing/mismatched bundled model
          // (`adb logcat -s ReactNativeJS`).
          console.warn('[conspect-tts] Kokoro failed, using system TTS:', err);
          useSystemRef.current = true;
          kokoroRef.current?.dispose();
          kokoroRef.current = null;
          startRun(fromWord);
        }
      })();
    },
    [hooks],
  );
  startRunRef.current = startRun;

  const toggle = useCallback(() => {
    const st = statusRef.current;
    if (st === 'playing') {
      if (activeKokoroRef.current) kokoroRef.current?.pause();
      else systemRef.current?.pause();
      setStatus('paused');
      return;
    }
    if (st === 'paused') {
      // Resume restarts the containing run at the current word — the Kokoro
      // disk cache makes the re-synthesized unit instant, and the system
      // engine re-speaks from its current word either way.
      const from = Math.max(0, wordIndexRef.current);
      setStatus('loading');
      startRun(from);
      return;
    }
    if (st === 'loading') {
      stop();
      return;
    }
    // Idle or done: (re)start from the current position.
    const from = Math.max(0, wordIndexRef.current);
    setWordIndex(from);
    setStatus('loading');
    startRun(from);
  }, [startRun, stop]);

  // Leaving the screen (or flipping to the quiz tab — both views stay
  // mounted behind a display flip) must silence the engine. Refs are stable,
  // so the cleanup sees drivers created after mount.
  useEffect(
    () => () => {
      kokoroRef.current?.dispose();
      systemRef.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    if (!enabled && statusRef.current !== 'idle') stop();
  }, [enabled, stop]);

  return {
    plan,
    hasAudio: plan.words.length > 0,
    status,
    wordIndex,
    activeWord: wordIndex >= 0 ? (plan.words[wordIndex] ?? null) : null,
    toggle,
    stop,
  } as const;
}
