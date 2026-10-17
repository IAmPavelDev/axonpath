import { KokoroDriver } from '@/lib/conspect-speech/kokoro';
import {
  buildSpeechPlan,
  stripLeadingH1,
  type SpeechPlan,
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

/** What both engines (bundled Kokoro, system expo-speech) expose. */
type ConspectDriver = Pick<SystemDriver, 'pause' | 'resume' | 'stop' | 'dispose'> & {
  start(plan: SpeechPlan, fromWord: number): Promise<void> | void;
};

/**
 * Drives conspect read-aloud. The bundled Kokoro-82M engine (on-device,
 * offline) is primary; if it fails to initialize or synthesize, the session
 * degrades to the system engine (expo-speech). Both report the word currently
 * being spoken, which the highlight renderer and the scroll-follow consume.
 */
export function useConspectSpeech(contentMd: string | null, enabled: boolean) {
  const plan = useMemo(() => buildSpeechPlan(stripLeadingH1(contentMd ?? '')), [contentMd]);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [wordIndex, setWordIndex] = useState(-1);

  const planRef = useRef(plan);
  planRef.current = plan;
  const statusRef = useRef(status);
  statusRef.current = status;
  const wordIndexRef = useRef(wordIndex);
  wordIndexRef.current = wordIndex;

  const hooks = useMemo<DriverHooks>(
    () => ({
      onWord: (index) => setWordIndex(index),
      onLoading: () => setStatus('loading'),
      onPlaying: () => setStatus('playing'),
      onDone: () => {
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
  /** Set once Kokoro has failed; the session then stays on the system engine. */
  const useSystemRef = useRef(false);

  const getDriver = (): ConspectDriver => {
    if (useSystemRef.current) {
      systemRef.current ??= createSystemDriver(hooks);
      return systemRef.current;
    }
    kokoroRef.current ??= new KokoroDriver(hooks);
    return kokoroRef.current;
  };

  const stop = useCallback(() => {
    kokoroRef.current?.stop();
    systemRef.current?.stop();
    setStatus('idle');
    setWordIndex(-1);
  }, []);

  const toggle = useCallback(() => {
    const st = statusRef.current;
    if (st === 'playing') {
      getDriver().pause();
      setStatus('paused');
      return;
    }
    if (st === 'paused') {
      getDriver().resume(planRef.current, Math.max(0, wordIndexRef.current));
      setStatus('playing');
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
    void (async () => {
      try {
        await getDriver().start(planRef.current, from);
      } catch {
        // Kokoro unavailable (init or synthesis failure) → degrade to the
        // system engine for the rest of the session.
        useSystemRef.current = true;
        kokoroRef.current?.dispose();
        kokoroRef.current = null;
        systemRef.current ??= createSystemDriver(hooks);
        systemRef.current.start(planRef.current, from);
        setStatus('playing');
      }
    })();
  }, [hooks, stop]);

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
