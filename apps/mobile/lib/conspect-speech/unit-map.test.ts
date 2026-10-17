import { describe, expect, it } from 'vitest';
import { buildSpeechPlan } from './word-map';
import { buildUnits, mapStarts, splitUnits, unitWordTexts } from './unit-map';

describe('splitUnits', () => {
  it('keeps one short text as a single unit', () => {
    expect(splitUnits('One two three.')).toEqual([{ offset: 0, length: 14 }]);
  });

  it('packs adjacent sentences under the char target', () => {
    const units = splitUnits('First one. Second one. Third one.');
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({ offset: 0, length: 33 });
  });

  it('splits at sentence ends once the target is exceeded, keeping offsets', () => {
    const sentence = 'A sentence of some length here.';
    const text = `${sentence} ${sentence} ${sentence} ${sentence} ${sentence} ${sentence} ${sentence} ${sentence}`;
    const units = splitUnits(text);
    expect(units.length).toBeGreaterThan(1);
    let covered = 0;
    for (const u of units) {
      expect(u.offset).toBe(covered);
      expect(text.slice(u.offset, u.offset + u.length).trim()).not.toBe('');
      covered = u.offset + u.length;
    }
    expect(covered).toBe(text.length);
  });

  it('includes a terminal-less tail in coverage', () => {
    const units = splitUnits('Done sentence. trailing words');
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({ offset: 0, length: 29 });
  });

  it('starts a new unit at a terminal-less tail when packing would overflow', () => {
    const first = `${'x'.repeat(215)}.`;
    const units = splitUnits(`${first} tail words`);
    expect(units).toHaveLength(2);
    expect(units[1]).toEqual({ offset: first.length, length: 11 });
  });
});

describe('buildUnits', () => {
  it('maps unit word ranges onto the global word list', () => {
    const plan = buildSpeechPlan('First sentence is here.\n\nSecond block follows now.');
    const units = buildUnits(plan);
    expect(units.length).toBeGreaterThanOrEqual(2);
    // Document order, no gaps or overlaps in global word coverage.
    let expected = 0;
    for (const unit of units) {
      expect(unit.firstGlobal).toBe(expected);
      expected += unit.wordCount;
    }
    expect(expected).toBe(plan.words.length);
  });

  it('round-trips unit words back to the chunk text', () => {
    const md = 'The I-140 follows PERM. Employer files it.';
    const plan = buildSpeechPlan(md);
    const chunk = plan.chunks[0];
    for (const unit of buildUnits(plan)) {
      const words = unitWordTexts(chunk.text, chunk.starts, unit);
      expect(words.length).toBe(unit.wordCount);
      for (const text of words) expect(text).not.toContain('  ');
    }
  });
});

describe('mapStarts', () => {
  it('stamps one subtitle per word, in order', () => {
    const starts = mapStarts(
      [
        { text: 'One', start: 0.0 },
        { text: 'two', start: 0.4 },
        { text: 'three.', start: 0.8 },
      ],
      ['One', 'two', 'three.'],
    );
    expect(starts).toEqual([0.0, 0.4, 0.8]);
  });

  it('consumes several words for a merged subtitle item', () => {
    const starts = mapStarts([{ text: 'One two three.', start: 0.1 }], ['One', 'two', 'three.']);
    expect(starts).toEqual([0.1, 0.1, 0.1]);
  });

  it('backfills words left unstamped by a tokenizer mismatch', () => {
    // Engine returned two items but split at a different boundary; the tail
    // word keeps the previous stamp instead of -1.
    const starts = mapStarts(
      [
        { text: 'One two', start: 0.0 },
        { text: 'three', start: 0.5 },
      ],
      ['One', 'two', 'three.', 'leftover'],
    );
    expect(starts).toEqual([0.0, 0.0, 0.5, 0.5]);
  });

  it('normalizes punctuation and case when matching', () => {
    const starts = mapStarts([{ text: "It's I-140!", start: 0.2 }], ["It's", 'I-140!']);
    expect(starts).toEqual([0.2, 0.2]);
  });
});
