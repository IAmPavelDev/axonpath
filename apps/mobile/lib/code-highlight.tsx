import { Fragment, type ReactNode } from 'react';
import { Text as RNText } from 'react-native';
import Prism from 'prismjs';
// Grammar side-effect imports; each extends Prism.languages. Order matters:
// a grammar must come after every grammar it extends (see prism components.js).
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';

export type Scheme = 'light' | 'dark';

/**
 * Token colors, GitHub-flavored. Deliberately NOT part of THEME: the UI
 * palette stays monochrome; color appears only inside code, where it carries
 * structure rather than decoration.
 */
type ColorSlot =
  | 'comment'
  | 'punctuation'
  | 'keyword'
  | 'string'
  | 'constant'
  | 'function'
  | 'className'
  | 'variable'
  | 'operator'
  | 'tag'
  | 'attrName'
  | 'selector'
  | 'inserted'
  | 'deleted';

const PALETTE: Record<Scheme, Record<ColorSlot, string>> = {
  light: {
    comment: 'hsl(213 9% 47%)',
    punctuation: 'hsl(213 9% 38%)',
    keyword: 'hsl(0 84% 47%)',
    string: 'hsl(222 82% 23%)',
    constant: 'hsl(212 92% 20%)',
    function: 'hsl(262 60% 60%)',
    className: 'hsl(29 90% 29%)',
    variable: 'hsl(29 90% 29%)',
    operator: 'hsl(212 92% 20%)',
    tag: 'hsl(145 66% 24%)',
    attrName: 'hsl(212 92% 20%)',
    selector: 'hsl(260 41% 48%)',
    inserted: 'hsl(145 66% 24%)',
    deleted: 'hsl(352 92% 27%)',
  },
  dark: {
    comment: 'hsl(213 10% 59%)',
    punctuation: 'hsl(210 14% 82%)',
    keyword: 'hsl(0 100% 73%)',
    string: 'hsl(206 100% 83%)',
    constant: 'hsl(210 100% 74%)',
    function: 'hsl(273 100% 86%)',
    className: 'hsl(32 100% 67%)',
    variable: 'hsl(32 100% 67%)',
    operator: 'hsl(0 100% 73%)',
    tag: 'hsl(135 63% 67%)',
    attrName: 'hsl(210 100% 74%)',
    selector: 'hsl(210 100% 74%)',
    inserted: 'hsl(135 63% 84%)',
    deleted: 'hsl(6 100% 86%)',
  },
};

/** Prism token type (or alias) → palette slot. Mirrors the default theme's grouping. */
const COLOR_BY_TYPE: Partial<Record<string, ColorSlot>> = {
  comment: 'comment',
  prolog: 'comment',
  doctype: 'comment',
  cdata: 'comment',
  punctuation: 'punctuation',
  keyword: 'keyword',
  atrule: 'keyword',
  important: 'keyword',
  rule: 'keyword',
  string: 'string',
  char: 'string',
  'attr-value': 'string',
  regex: 'string',
  property: 'constant',
  boolean: 'constant',
  inserted: 'inserted',
  deleted: 'deleted',
  // Composite/nested token types that surface through real grammars:
  environment: 'variable',
  'template-string': 'string',
  interpolation: 'variable',
  generic: 'className',
  decorator: 'function',
  'maybe-class-name': 'className',
  constant: 'constant',
  symbol: 'constant',
  builtin: 'constant',
  function: 'function',
  'class-name': 'className',
  variable: 'variable',
  operator: 'operator',
  entity: 'operator',
  url: 'operator',
  tag: 'tag',
  'attr-name': 'attrName',
  selector: 'selector',
};

/**
 * Fence-info string (```ts, ```python…) → a loaded Prism language id, or
 * null when the fence is untagged or the language isn't bundled — plain
 * monochrome code is the fallback, never a crash.
 */
const LANG_ALIASES: Record<string, string | null> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  golang: 'go',
  kt: 'kotlin',
  kts: 'kotlin',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  text: null,
  txt: null,
  plain: null,
  plaintext: null,
  md: null,
  markdown: null,
};

export const resolveLanguage = (info?: string | null): string | null => {
  if (!info) return null;
  const raw = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!raw) return null;
  const lang = raw in LANG_ALIASES ? LANG_ALIASES[raw] : raw;
  return lang !== null && lang !== undefined && Prism.languages[lang] ? lang : null;
};

const colorFor = (token: Prism.Token, palette: Record<ColorSlot, string>): string | undefined => {
  const aliases = token.alias ? (Array.isArray(token.alias) ? token.alias : [token.alias]) : [];
  for (const name of [token.type, ...aliases]) {
    const slot = COLOR_BY_TYPE[name];
    if (slot) return palette[slot];
  }
  return undefined;
};

const renderTokens = (
  tokens: (string | Prism.Token)[],
  palette: Record<ColorSlot, string>,
  key: string
): ReactNode[] =>
  tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const color = colorFor(token, palette);
    const content = token.content;
    const children =
      typeof content === 'string'
        ? content
        : renderTokens(Array.isArray(content) ? content : [content], palette, `${key}.${index}`);
    return (
      <RNText key={`${key}.${index}`} style={color ? { color } : undefined}>
        {children}
      </RNText>
    );
  });

/**
 * Tokenize `code` with Prism and return nested colored <Text> spans to embed
 * inside a monospaced container <Text>. Unknown language → the raw string,
 * inheriting the container's color.
 */
export const highlightSpans = (code: string, lang: string | null, scheme: Scheme): ReactNode => {
  if (!lang || !Prism.languages[lang]) return code;
  return (
    <Fragment>
      {renderTokens(Prism.tokenize(code, Prism.languages[lang]), PALETTE[scheme], 't')}
    </Fragment>
  );
};
