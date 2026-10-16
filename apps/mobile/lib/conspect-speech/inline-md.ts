/**
 * Display-side markdown parsing for the spoken view of a chunk. Both parsers
 * produce char ranges into the chunk's RAW markdown — the same coordinate
 * space as `SpeechWord` — so the highlight renderer can style exactly the
 * word being spoken while keeping bold/italic/code/link looks from markdown.
 *
 * Scoped to what conspects actually contain inline (emphasis, code, links);
 * anything unknown stays plain text. No lookbehind (Hermes-compatible).
 */

export type InlineStyle = 'strong' | 'em' | 'code' | 'link';
export type InlineSegment = { start: number; end: number; style: InlineStyle | null };
export type BlockKind = 'heading' | 'paragraph' | 'list' | 'quote' | 'table' | 'hr';
export type BlockSpan = { kind: BlockKind; start: number; end: number; level?: number };

type StyleRange = { start: number; end: number; style: InlineStyle };

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/**
 * Collects styled ranges (content only — markers excluded) with a delimiter
 * stack whose NEAREST matching opener wins, so `*inner*` closes inside
 * `**outer**` instead of tearing both open. Link labels take their range;
 * the `(url)` part never styles. Unclosed openers degrade to plain text.
 */
const collectRanges = (md: string): StyleRange[] => {
  const ranges: StyleRange[] = [];
  type Open = { ch: string; run: number; contentStart: number; style: InlineStyle };
  const stack: Open[] = [];
  let i = 0;

  const nearestOpen = (ch: string, run: number): number => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].ch === ch && (ch !== '`' || stack[k].run === run)) return k;
    }
    return -1;
  };

  while (i < md.length) {
    const ch = md[i];
    if (ch === '\\' && i + 1 < md.length) {
      i += 2; // escaped char stays literal
      continue;
    }
    if (ch === '`' || ch === '*' || ch === '_') {
      let j = i;
      while (j < md.length && md[j] === ch) j++;
      const run = j - i;
      const openIdx = nearestOpen(ch, run);
      const canClose = openIdx >= 0 && run <= 3 && !isSpace(md[i - 1]);
      const canOpen =
        run <= 3 &&
        !isSpace(md[j]) &&
        (ch !== '`' || md.indexOf('`'.repeat(run), j) !== -1);
      if (canClose) {
        const open = stack[openIdx];
        ranges.push({ start: open.contentStart, end: i, style: open.style });
        stack.splice(openIdx, 1);
      } else if (canOpen) {
        stack.push({
          ch,
          run,
          contentStart: j,
          style: ch === '`' ? 'code' : run >= 2 ? 'strong' : 'em',
        });
      }
      i = j;
      continue;
    }
    if (ch === '[') {
      const closeBracket = md.indexOf(']', i);
      if (closeBracket !== -1 && md[closeBracket + 1] === '(') {
        const closeParen = md.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          if (closeBracket > i + 1) ranges.push({ start: i + 1, end: closeBracket, style: 'link' });
          i = closeParen + 1;
          continue;
        }
      }
      i++;
      continue;
    }
    i++;
  }
  return ranges;
};

/**
 * Flat, non-overlapping segments covering the whole string; a position's
 * style is its innermost styled range (latest start), null when plain.
 */
export const parseInlineSegments = (md: string): InlineSegment[] => {
  const ranges = collectRanges(md).sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: InlineSegment[] = [];
  const active: StyleRange[] = [];
  let pos = 0;
  let nextRange = 0;

  const pushSeg = (end: number) => {
    if (end <= pos) return;
    const style = active.length ? active[active.length - 1].style : null;
    const last = segments[segments.length - 1];
    if (last && last.style === style && last.end === pos) last.end = end;
    else segments.push({ start: pos, end, style });
    pos = end;
  };

  while (pos < md.length) {
    let next = md.length;
    for (let k = nextRange; k < ranges.length; k++) {
      if (ranges[k].start > pos) {
        next = Math.min(next, ranges[k].start);
        break;
      }
    }
    for (const range of active) next = Math.min(next, range.end);
    pushSeg(next);

    for (let k = nextRange; k < ranges.length; k++) {
      if (ranges[k].start === next) {
        active.push(ranges[k]);
        nextRange = k + 1;
      } else if (ranges[k].start > next) break;
    }
    for (let k = active.length - 1; k >= 0; k--) if (active[k].end === next) active.splice(k, 1);
  }
  pushSeg(md.length);
  return segments;
};

const HEADING_LINE = /^ {0,3}(#{1,6})\s+/;
const LIST_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/;
const QUOTE_LINE = /^ {0,3}>/;
const HR_LINE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

/** Block-level layout spans of a chunk, document order (hrs kept for layout). */
export const parseChunkLayout = (md: string): BlockSpan[] => {
  const spans: BlockSpan[] = [];
  let pos = 0;
  let prevLineEnd = 0;
  let cur: { kind: BlockKind; start: number; level?: number } | null = null;

  const flush = (end: number) => {
    if (cur) spans.push({ kind: cur.kind, start: cur.start, end, level: cur.level });
    cur = null;
  };

  for (const line of md.split('\n')) {
    const lineEnd = pos + line.length;
    const heading = HEADING_LINE.exec(line);
    if (HR_LINE.test(line)) {
      flush(prevLineEnd);
      spans.push({ kind: 'hr', start: pos, end: lineEnd });
    } else if (heading) {
      flush(prevLineEnd);
      spans.push({ kind: 'heading', start: pos, end: lineEnd, level: heading[1].length });
    } else if (line.includes('|') && line.trim().length > 0) {
      if (!cur || cur.kind !== 'table') {
        flush(prevLineEnd);
        cur = { kind: 'table', start: pos };
      }
    } else if (LIST_LINE.test(line)) {
      if (!cur || cur.kind !== 'list') {
        flush(prevLineEnd);
        cur = { kind: 'list', start: pos };
      }
    } else if (QUOTE_LINE.test(line)) {
      if (!cur || cur.kind !== 'quote') {
        flush(prevLineEnd);
        cur = { kind: 'quote', start: pos };
      }
    } else if (line.trim().length === 0) {
      flush(prevLineEnd);
    } else {
      if (!cur || cur.kind !== 'paragraph') {
        flush(prevLineEnd);
        cur = { kind: 'paragraph', start: pos };
      }
    }
    pos = lineEnd + 1;
    prevLineEnd = lineEnd;
  }
  flush(prevLineEnd);
  return spans;
};
