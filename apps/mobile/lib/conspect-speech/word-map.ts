/**
 * Speech plan for conspect read-aloud: the exact word sequence a TTS engine
 * reads plus the mapping needed to highlight each word as it is spoken.
 *
 * Offsets are keyed to strings this module produces: chunk strings come from
 * `splitConspectChunks` — the same strings `ClassConspect` renders — so a
 * word's `[chunkStart, chunkEnd)` highlights directly against the rendered
 * markdown of its chunk. `onBoundary` char offsets map onto `SpeechChunk`.
 *
 * Fully local (expo-speech): no audio file exists, word timings arrive live
 * while speaking; the plan is the shared coordinate space for that mapping.
 */
import { splitConspectChunks } from '../conspect-chunks';

/** ClassConspect strips a leading h1 before chunking; speech must see the same. */
export const stripLeadingH1 = (md: string): string => md.replace(/^#[^\n]+\n+/, '');

export type SpeechWord = {
  /** Zero-based chunk (top-level conspect block) the word belongs to. */
  chunk: number;
  /** Char range inside the chunk's raw markdown (for the renderer). */
  chunkStart: number;
  chunkEnd: number;
};

export type SpeechChunk = {
  /** Speakable text handed to the engine for one utterance. */
  text: string;
  /** Index of this chunk's first word in the plan-wide word list. */
  firstWord: number;
  /** Char offset of each word inside `text` (parallel to its word range). */
  starts: number[];
};

export type SpeechPlan = {
  /** Every speakable word, document order. */
  words: SpeechWord[];
  /** Utterance-sized speakable chunks, document order. */
  chunks: SpeechChunk[];
};

const FENCE_CHUNK = /^ {0,3}(```+|~~~+)/;
const HEADING_LINE = /^ {0,3}(#{1,6})(\s+|$)/;
const LIST_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(\s+|$)/;
const QUOTE_LINE = /^ {0,3}(?:>\s?)+/;
const HR_LINE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const UNDERLINE_LINE = /^ {0,3}(?:=+|-+)\s*$/;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK_RE = /\[([^\]]*)\]\(([^)]*)\)/g;
const MARKER_RUN_RE = /\*{1,3}|~~|`+/g;
/** Words per utterance chunk target; chunks split at sentence ends below it. */
const CHUNK_TARGET_CHARS = 800;
const SENTENCE_END = /[.!?…]["'”’)\]]?$/;

/** A table separator row (`|---|:-:|`) — carries no speakable words. */
const isTableSeparator = (line: string): boolean => {
  if (!line.includes('|')) return false;
  const cells = line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
};

/**
 * Marks underscore emphasis runs (`_so_`) as droppable without lookbehind —
 * Hermes lacks it. Intra-word underscores (snake_case) are never emphasis.
 */
const dropUnderscoreRuns = (line: string, drop: (index: number) => void): void => {
  const isSoft = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
  const isPunct = (ch: string | undefined) => ch !== undefined && /[\s.,;:!?)\]}]/.test(ch);
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '_') {
      i++;
      continue;
    }
    let j = i;
    while (j < line.length && line[j] === '_') j++;
    const run = j - i;
    const opens = run <= 3 && isSoft(line[i - 1]) && !isSoft(line[j]);
    const closes = run <= 3 && !isSoft(line[i - 1]) && isPunct(line[j]);
    if (opens || closes) for (let k = i; k < j; k++) drop(k);
    i = j;
  }
};

type Token = { start: number; end: number; text: string };

/**
 * Speakable whitespace tokens of one chunk, with offsets into the chunk's raw
 * markdown. Markdown syntax chars are masked out; kept punctuation rides its
 * word so the engine still hears sentence pauses. Fence chunks → no tokens.
 */
const chunkTokens = (chunkMd: string): Token[] => {
  if (FENCE_CHUNK.test(chunkMd)) return [];
  const mask = new Uint8Array(chunkMd.length);
  let lineStart = 0;

  for (const line of chunkMd.split('\n')) {
    const lineEnd = lineStart + line.length;
    const dropAll = () => {
      for (let i = lineStart; i < lineEnd; i++) mask[i] = 1;
    };
    const dropRange = (from: number, to: number) => {
      for (let i = Math.max(0, from); i < Math.min(line.length, to); i++) mask[lineStart + i] = 1;
    };

    if (HR_LINE.test(line) || UNDERLINE_LINE.test(line) || isTableSeparator(line)) {
      dropAll();
    } else {
      const heading = HEADING_LINE.exec(line);
      if (heading) dropRange(0, heading[0].length);
      const list = LIST_LINE.exec(line);
      if (list) dropRange(0, list[0].length);
      const quote = QUOTE_LINE.exec(line);
      if (quote) dropRange(0, quote[0].length);
      if (line.includes('|')) {
        for (let i = 0; i < line.length; i++) if (line[i] === '|') dropRange(i, i + 1);
      }
      let m: RegExpExecArray | null;
      IMAGE_RE.lastIndex = 0;
      while ((m = IMAGE_RE.exec(line))) dropRange(m.index, m.index + m[0].length);
      LINK_RE.lastIndex = 0;
      while ((m = LINK_RE.exec(line))) {
        dropRange(m.index, m.index + 1); // '['
        dropRange(m.index + 1 + m[1].length, m.index + m[0].length); // '](url)'
      }
      MARKER_RUN_RE.lastIndex = 0;
      while ((m = MARKER_RUN_RE.exec(line))) dropRange(m.index, m.index + m[0].length);
      dropUnderscoreRuns(line, (i) => dropRange(i, i + 1));
    }
    lineStart = lineEnd + 1;
  }

  const tokens: Token[] = [];
  let i = 0;
  while (i < chunkMd.length) {
    if (mask[i] || /\s/.test(chunkMd[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < chunkMd.length && !mask[j] && !/\s/.test(chunkMd[j])) j++;
    tokens.push({ start: i, end: j, text: chunkMd.slice(i, j) });
    i = j;
  }
  return tokens;
};

/**
 * Builds the plan: words per chunk (mask tokens), then sentence-bounded
 * utterance chunks within the per-utterance char target. Each chunk starts a
 * fresh utterance, which also gives natural pauses between blocks.
 */
export const buildSpeechPlan = (md: string): SpeechPlan => {
  const chunkMds = splitConspectChunks(stripLeadingH1(md));
  const words: SpeechWord[] = [];
  const chunks: SpeechChunk[] = [];

  chunkMds.forEach((chunkMd, chunk) => {
    const tokens = chunkTokens(chunkMd);
    if (tokens.length === 0) return;
    const base = words.length;
    for (const token of tokens) words.push({ chunk, chunkStart: token.start, chunkEnd: token.end });

    const emit = (from: number, to: number) => {
      const starts: number[] = [];
      const parts: string[] = [];
      let offset = 0;
      for (let k = from; k <= to; k++) {
        starts.push(offset);
        parts.push(tokens[k].text);
        offset += tokens[k].text.length + 1;
      }
      chunks.push({ text: parts.join(' '), firstWord: base + from, starts });
    };

    let s = 0;
    let len = 0;
    for (let i = 0; i < tokens.length; i++) {
      const nextLen = i === s ? tokens[i].text.length : len + 1 + tokens[i].text.length;
      if (i > s && nextLen > CHUNK_TARGET_CHARS) {
        emit(s, i - 1);
        s = i;
        len = tokens[i].text.length;
      } else {
        len = nextLen;
      }
      const last = i === tokens.length - 1;
      if (SENTENCE_END.test(tokens[i].text) && (len >= 200 || last)) {
        emit(s, i);
        s = i + 1;
        len = 0;
      }
    }
    if (s < tokens.length) emit(s, tokens.length - 1);
  });

  return { words, chunks };
};

/** Chunk owning a global word index (binary search over `firstWord`). */
export const findChunkForWord = (plan: SpeechPlan, wordIndex: number): SpeechChunk | null => {
  if (wordIndex < 0 || wordIndex >= plan.words.length || plan.chunks.length === 0) return null;
  let lo = 0;
  let hi = plan.chunks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (plan.chunks[mid].firstWord <= wordIndex) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found === -1 ? null : plan.chunks[found];
};

/** Local word index whose spoken range contains the boundary char offset. */
export const localWordForChar = (chunk: SpeechChunk, charIndex: number): number => {
  let lo = 0;
  let hi = chunk.starts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chunk.starts[mid] <= charIndex) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};
