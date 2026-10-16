import { describe, expect, it } from 'vitest';
import { splitConspectChunks } from '../conspect-chunks';
import type { SpeechPlan } from './word-map';
import { buildSpeechPlan, findChunkForWord, localWordForChar, stripLeadingH1 } from './word-map';
/** Slice a word's text back out of its chunk's raw markdown. */
const wordText = (md: string, plan: SpeechPlan, index: number) => {
  const word = plan.words[index];
  const chunks = splitConspectChunks(stripLeadingH1(md));
  return chunks[word.chunk].slice(word.chunkStart, word.chunkEnd);
};

describe('stripLeadingH1', () => {
  it('removes a leading h1 and the blank lines after it', () => {
    expect(stripLeadingH1('# Title\n\nbody')).toBe('body');
  });

  it('strips a leading heading of any level (display-parity contract)', () => {
    expect(stripLeadingH1('## Keep\n\n# not leading')).toBe('# not leading');
  });

  it('keeps a non-leading heading untouched', () => {
    const md = 'Intro\n\n# not leading';
    expect(stripLeadingH1(md)).toBe(md);
  });
});

describe('buildSpeechPlan', () => {
  it('tokenizes a plain paragraph with offsets into the chunk string', () => {
    const md = 'One two three.';
    const plan = buildSpeechPlan(md);
    expect(plan.words.map((_, i) => wordText(md, plan, i))).toEqual(['One', 'two', 'three.']);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].text).toBe('One two three.');
  });

  it('excludes heading markers but keeps heading text', () => {
    const md = 'Intro line.\n\n## The Heading\n\nBody starts here.';
    const plan = buildSpeechPlan(md);
    expect(wordText(md, plan, 0)).toBe('Intro');
    const theIndex = plan.words.findIndex((_, i) => wordText(md, plan, i) === 'The');
    expect(theIndex).toBeGreaterThan(0);
    expect(plan.words[theIndex].chunkStart).toBe(3);
  });

  it('drops emphasis markers and link syntax, keeps labels', () => {
    const md = 'See **bold** and [docs](https://example.com/x) now.';
    const plan = buildSpeechPlan(md);
    expect(plan.words.map((_, i) => wordText(md, plan, i))).toEqual([
      'See',
      'bold',
      'and',
      'docs',
      'now.',
    ]);
  });

  it('drops images entirely', () => {
    const md = 'Before ![alt text](https://example.com/i.png) after';
    const plan = buildSpeechPlan(md);
    expect(plan.words.map((_, i) => wordText(md, plan, i))).toEqual(['Before', 'after']);
  });

  it('never reads code fence chunks', () => {
    const md = 'para\n\n```js\nconst nope = 1;\n```\n\nafter';
    const plan = buildSpeechPlan(md);
    expect(plan.words.map((_, i) => wordText(md, plan, i)).join(' ')).toBe('para after');
  });

  it('drops hrs, setext underlines and table separator rows', () => {
    const md = 'text\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const plan = buildSpeechPlan(md);
    expect(plan.words.map((_, i) => wordText(md, plan, i)).join(' ')).toBe('text a b 1 2');
  });

  it('drops list markers but keeps intra-word underscores', () => {
    const md = '- use snake_case_name here\n- _soft_ emphasis';
    const plan = buildSpeechPlan(md);
    expect(plan.words.map((_, i) => wordText(md, plan, i))).toEqual([
      'use',
      'snake_case_name',
      'here',
      'soft',
      'emphasis',
    ]);
  });

  it('keeps short multi-sentence text in one utterance chunk', () => {
    const plan = buildSpeechPlan('First sentence. Second one. Third.');
    expect(plan.chunks).toHaveLength(1);
  });

  it('splits long text into contiguous utterance chunks', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog again and again. ';
    const md = sentence.repeat(30); // ~1900 chars, > 800 target
    const plan = buildSpeechPlan(md);
    expect(plan.chunks.length).toBeGreaterThan(1);
    plan.chunks.forEach((chunk, i) => {
      expect(chunk.starts.length).toBeGreaterThan(0);
      expect(chunk.firstWord + chunk.starts.length).toBe(
        plan.chunks[i + 1]?.firstWord ?? plan.words.length,
      );
    });
  });

  it('maps every word through findChunkForWord and localWordForChar', () => {
    const md = '## Head\n\nPara one here. Para two there.\n\n- item one\n- item two';
    const plan = buildSpeechPlan(md);
    plan.words.forEach((_, i) => {
      const chunk = findChunkForWord(plan, i);
      expect(chunk).not.toBeNull();
      const local = i - chunk!.firstWord;
      expect(localWordForChar(chunk!, chunk!.starts[local])).toBe(local);
      // a boundary anywhere inside the word still resolves to that word
      expect(localWordForChar(chunk!, chunk!.starts[local] + 1)).toBe(local);
    });
    expect(findChunkForWord(plan, -1)).toBeNull();
    expect(findChunkForWord(plan, plan.words.length)).toBeNull();
  });
});
