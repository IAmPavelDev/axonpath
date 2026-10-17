/**
 * Pure mapping between the speech plan and Kokoro playback units: splitting
 * chunks into synthesizable units and aligning the engine's subtitle items
 * back onto the plan's global word list. No native imports — unit tested.
 */
import type { SpeechPlan } from './word-map';

/** Unit target: small enough for ~2s of synthesis, a few sentences wide. */
export const UNIT_TARGET_CHARS = 220;

/** One playable slice of a plan chunk: a text range plus its word range. */
export type Unit = {
  chunkIdx: number;
  /** Char range within the chunk's speakable text. */
  offset: number;
  length: number;
  /** Global word index of the unit's first word. */
  firstGlobal: number;
  wordCount: number;
  /** Speech language of the unit — its chunk never mixes languages. */
  lang: string | null;
};

export type UnitAudio = {
  uri: string;
  /** Start time (unit-local seconds) per unit word. */
  starts: number[];
  /** Synthesized duration in seconds. */
  duration: number;
};

/** Letters/digits only — the baseline for aligning subtitle items to words. */
export const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Splits chunk text into sentence-bounded units, keeping char offsets. */
export const splitUnits = (text: string): { offset: number; length: number }[] => {
  const bounds: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/[.!?…]/.test(text[i]) && (i + 1 >= text.length || text[i + 1] === ' ')) {
      bounds.push(i + 1);
    }
  }
  if (!bounds.length || bounds[bounds.length - 1] !== text.length) bounds.push(text.length);
  const units: { offset: number; length: number }[] = [];
  let start = 0;
  for (const end of bounds) {
    const slice = text.slice(start, end);
    if (!slice.trim()) {
      start = end;
      continue;
    }
    const prev = units[units.length - 1];
    if (prev && prev.length + slice.length <= UNIT_TARGET_CHARS) {
      prev.length = end - prev.offset;
    } else {
      units.push({ offset: start, length: end - start });
    }
    start = end;
  }
  return units;
};

/** Flattens a plan into playback units (document order). */
export const buildUnits = (plan: SpeechPlan): Unit[] => {
  const units: Unit[] = [];
  plan.chunks.forEach((chunk, chunkIdx) => {
    for (const span of splitUnits(chunk.text)) {
      let first = -1;
      let count = 0;
      for (let i = 0; i < chunk.starts.length; i++) {
        const s = chunk.starts[i];
        if (s < span.offset) continue;
        if (s >= span.offset + span.length) break;
        if (first < 0) first = i;
        count++;
      }
      if (count > 0) {
        units.push({
          chunkIdx,
          ...span,
          firstGlobal: chunk.firstWord + first,
          wordCount: count,
          lang: chunk.lang,
        });
      }
    }
  });
  return units;
};

/** Whitespace tokens of the unit, matching the plan's word order. */
export const unitWordTexts = (
  chunkText: string,
  chunkStarts: number[],
  unit: Unit,
): string[] => {
  const texts: string[] = [];
  for (let i = 0; i < chunkStarts.length; i++) {
    const s = chunkStarts[i];
    if (s < unit.offset) continue;
    if (s >= unit.offset + unit.length) break;
    const next = Math.min(
      chunkStarts[i + 1] ?? unit.offset + unit.length,
      unit.offset + unit.length,
    );
    texts.push(chunkText.slice(s, next).trim());
  }
  return texts;
};

/**
 * Maps subtitle items onto unit words in document order. Fast-mode timing is
 * estimated anyway, so a greedy one-to-one walk is sufficient; a word count
 * mismatch degrades to backfilling the previous stamp.
 */
export const mapStarts = (subs: { text: string; start: number }[], wordTexts: string[]): number[] => {
  const starts = new Array<number>(wordTexts.length).fill(-1);
  let w = 0;
  for (const sub of subs) {
    const target = normalize(sub.text);
    if (!target || w >= wordTexts.length) continue;
    let acc = '';
    while (w < wordTexts.length) {
      if (starts[w] === -1) starts[w] = sub.start;
      acc += normalize(wordTexts[w]);
      w++;
      if (acc.length >= target.length) break;
    }
  }
  let last = subs.length > 0 ? subs[subs.length - 1].start : 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] === -1) starts[i] = last;
    else last = starts[i];
  }
  return starts;
};
