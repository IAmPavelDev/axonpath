import { describe, expect, it } from 'vitest';
import { parseChunkLayout, parseInlineSegments } from './inline-md';

const styleAt = (md: string, index: number) => {
  const seg = parseInlineSegments(md).find((s) => s.start <= index && index < s.end);
  return seg?.style ?? null;
};

describe('parseInlineSegments', () => {
  it('plain text is one unstyled segment', () => {
    const md = 'just plain words';
    const segments = parseInlineSegments(md);
    expect(segments).toEqual([{ start: 0, end: md.length, style: null }]);
  });

  it('styles bold, italic and code spans, markers excluded', () => {
    const md = 'a **b** c *d* e `f` g';
    expect(styleAt(md, md.indexOf('b'))).toBe('strong');
    expect(styleAt(md, md.indexOf('d'))).toBe('em');
    expect(styleAt(md, md.indexOf('f'))).toBe('code');
    expect(styleAt(md, 0)).toBeNull();
    expect(styleAt(md, md.indexOf('g'))).toBeNull();
  });

  it('nested emphasis: innermost style wins', () => {
    const md = 'x **bold *inner* tail** z';
    expect(styleAt(md, md.indexOf('bold'))).toBe('strong');
    expect(styleAt(md, md.indexOf('inner'))).toBe('em');
    expect(styleAt(md, md.indexOf('tail'))).toBe('strong');
    expect(styleAt(md, md.indexOf('z'))).toBeNull();
  });

  it('link labels are links, the url part is plain', () => {
    const md = 'see [docs](https://example.com) end';
    expect(styleAt(md, md.indexOf('docs'))).toBe('link');
    expect(styleAt(md, md.indexOf('https://'))).toBeNull();
    expect(styleAt(md, md.indexOf('end'))).toBeNull();
  });

  it('unmatched markers stay plain', () => {
    const md = 'a * b and ** c';
    expect(parseInlineSegments(md).every((s) => s.style === null)).toBe(true);
  });
});

describe('parseChunkLayout', () => {
  it('classifies blocks in document order with raw offsets', () => {
    const md = '# Title\n\npara one\npara two\n\n- item a\n- item b\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail';
    const spans = parseChunkLayout(md);
    expect(spans.map((s) => s.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'quote',
      'table',
      'paragraph',
    ]);
    expect(spans[0].level).toBe(1);
    expect(md.slice(spans[1].start, spans[1].end)).toBe('para one\npara two');
    expect(md.slice(spans[2].start, spans[2].end)).toBe('- item a\n- item b');
  });

  it('a heading starts a fresh span without a blank line', () => {
    const md = 'para\n## Head\nbody';
    const spans = parseChunkLayout(md);
    expect(spans.map((s) => s.kind)).toEqual(['paragraph', 'heading', 'paragraph']);
  });

  it('marks hrs', () => {
    const spans = parseChunkLayout('above\n\n---\n\nbelow');
    expect(spans.map((s) => s.kind)).toEqual(['paragraph', 'hr', 'paragraph']);
  });
});
