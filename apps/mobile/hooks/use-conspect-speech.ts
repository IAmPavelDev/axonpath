import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import type { Timeout } from '@/types/global';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSpeechPlan,
  findChunkForWord,
  localWordForChar,
  stripLeadingH1,
  type SpeechPlan,
} from '@/lib/conspect-speech/word-map';

/** English-only for now; per-class language arrives when classes carry one. */
const SPEECH_LANGUAGE = 'en-US';
/** Fallback cadence for engines that never fire boundary events. */
const ESTIMATE_MS_PER_WORD = 340;
/** Grace window before deciding the engine gives no boundaries. */
const BOUNDARY_GRACE_MS = 1800;

export type SpeechStatus = 'idle' | 'playing' | 'paused' | 'done';

type BoundaryEvent = { charIndex?: number };

/**
 * Drives conspect read-aloud on the device TTS engine (expo-speech). The
 * speech plan supplies word offsets; `onBoundary` char offsets map through
 * the in-flight utterance back to plan words, which is what the highlight
 * renderer consumes.
 *
 * `Speech.pause()` is iOS-only in expo-speech, so Android pauses by stopping
 * and later re-speaking from the current word — the same path seeking uses.
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
  /** Mapping for the utterance in flight: its first global word + local starts. */
  const spoken = useRef({ base: 0, starts: [] as number[] });
  const gotBoundary = useRef(false);
  const graceTimer = useRef<Timeout | undefined>(undefined);
  const estimateTimer = useRef<Timeout | undefined>(undefined);

  const clearTimers = () => {
    clearTimeout(graceTimer.current);
    clearInterval(estimateTimer.current);
    graceTimer.current = undefined;
    estimateTimer.current = undefined;
  };

  const stop = useCallback(() => {
    clearTimers();
    Speech.stop();
    setStatus('idle');
    setWordIndex(-1);
  }, []);

  const speakFromRef = useRef<(currentPlan: SpeechPlan, word: number) => void>(() => {});
  const speakFrom = useCallback(
    (currentPlan: SpeechPlan, word: number) => {
      const chunk = findChunkForWord(currentPlan, word);
      if (!chunk) {
        setStatus('done');
        setWordIndex(-1);
        return;
      }
      const chunkIdx = currentPlan.chunks.indexOf(chunk);
      const local = word - chunk.firstWord;
      const offset = chunk.starts[local] ?? 0;
      spoken.current = { base: word, starts: chunk.starts.slice(local).map((s) => s - offset) };
      gotBoundary.current = false;
      clearTimers();
      Speech.stop();
      Speech.speak(chunk.text.slice(offset), {
        language: SPEECH_LANGUAGE,
        onBoundary: (ev: BoundaryEvent) => {
          if (typeof ev.charIndex !== 'number') return;
          gotBoundary.current = true;
          if (estimateTimer.current) {
            clearInterval(estimateTimer.current);
            estimateTimer.current = undefined;
          }
          const localIdx = localWordForChar(
            { ...chunk, starts: spoken.current.starts },
            ev.charIndex,
          );
          setWordIndex(spoken.current.base + localIdx);
        },
        onDone: () => {
          if (statusRef.current !== 'playing') return;
          const next = planRef.current.chunks[chunkIdx + 1];
          if (next) speakFromRef.current(planRef.current, next.firstWord);
          else {
            setStatus('done');
            setWordIndex(-1);
          }
        },
        onError: () => stop(),
      } as Speech.SpeechOptions);
      setStatus('playing');
      // Engines without boundary events (API < 26, odd OEM TTS): keep the
      // highlight moving on an estimate; a real boundary cancels it.
      graceTimer.current = setTimeout(() => {
        if (gotBoundary.current || statusRef.current !== 'playing') return;
        estimateTimer.current = setInterval(() => {
          setWordIndex((w) => Math.min(w + 1, planRef.current.words.length - 1));
        }, ESTIMATE_MS_PER_WORD);
      }, BOUNDARY_GRACE_MS);
    },
    [stop],
  );
  speakFromRef.current = speakFrom;

  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') {
      if (Platform.OS === 'ios') Speech.pause();
      else Speech.stop();
      clearTimers();
      setStatus('paused');
      return;
    }
    if (statusRef.current === 'paused') {
      if (Platform.OS === 'ios') Speech.resume();
      else speakFrom(planRef.current, Math.max(0, wordIndexRef.current));
      return;
    }
    speakFrom(planRef.current, Math.max(0, wordIndexRef.current));
  }, [speakFrom]);

  // Leaving the screen (or flipping to the quiz tab — both views stay
  // mounted behind a display flip) must silence the engine.
  useEffect(
    () => () => {
      clearTimers();
      Speech.stop();
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
