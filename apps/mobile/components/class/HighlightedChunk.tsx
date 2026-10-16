import { makeStyles } from '@/lib/conspect-markdown';
import { FONTS, THEME } from '@/lib/theme';
import { parseChunkLayout, parseInlineSegments, type InlineSegment } from '@/lib/conspect-speech/inline-md';
import type { SpeechPlan } from '@/lib/conspect-speech/word-map';
import { useColorScheme } from 'nativewind';
import { useMemo } from 'react';
import type { FC } from 'react';
import { Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

type Props = {
  md: string;
  plan: SpeechPlan;
  chunkIndex: number;
  activeWordIndex: number;
};

const LIST_MARKER = /^ {0,3}(?:([-*+])|(\d{1,9})[.)])\s+/;
const TABLE_SEPARATOR = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const HEADING_KEYS = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
] as const;

/**
 * Word-highlighted rendering of the chunk currently being read. Swapped in
 * for `ConspectMarkdown` only while speech is active on this chunk; the
 * typography comes from the same `makeStyles`, so the swap stays visually
 * quiet. Code fences never contain words, so a spoken chunk is always
 * prose-ish: headings, paragraphs, lists, quotes, tables.
 */
export const HighlightedChunk: FC<Props> = ({ md, plan, chunkIndex, activeWordIndex }) => {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const ink = THEME[scheme];
  const mdStyles = useMemo(() => makeStyles(scheme), [scheme]);
  const inlineStyles: Record<NonNullable<InlineSegment['style']>, TextStyle> = {
    strong: mdStyles.strong,
    em: mdStyles.em,
    code: mdStyles.code_inline,
    link: mdStyles.link,
  };

  const blocks = useMemo(() => {
    const segments = parseInlineSegments(md);
    const lines: { start: number; text: string }[] = [];
    let pos = 0;
    for (const text of md.split('\n')) {
      lines.push({ start: pos, text });
      pos += text.length + 1;
    }
    const chunkWords = plan.words
      .map((word, index) => ({ ...word, index }))
      .filter((word) => word.chunk === chunkIndex);

    return parseChunkLayout(md)
      .filter((span) => span.kind !== 'hr')
      .map((span) => {
        const headingKey =
          span.kind === 'heading' ? HEADING_KEYS[Math.min(5, (span.level ?? 1) - 1)] : null;
        const container: ViewStyle =
          span.kind === 'quote'
            ? {
                borderLeftWidth: 2,
                borderLeftColor: ink.foreground,
                paddingLeft: 16,
                marginLeft: 2,
                marginVertical: 22,
              }
            : headingKey
              ? {
                  marginTop: mdStyles[headingKey].marginTop,
                  marginBottom: mdStyles[headingKey].marginBottom,
                }
              : { marginBottom: 16 };
        const textStyle: TextStyle =
          span.kind === 'quote'
            ? mdStyles.blockquote
            : headingKey
              ? mdStyles[headingKey]
              : span.kind === 'table'
                ? { fontFamily: FONTS.sansRegular, fontSize: 14, lineHeight: 20, color: ink.foreground }
                : mdStyles.text;

        const lines = lines0(md, span.start, span.end).map((line) => {
          const markerMatch = span.kind === 'list' ? LIST_MARKER.exec(line.text) : null;
          const marker = markerMatch ? (markerMatch[1] ? '•' : `${markerMatch[2]}.`) : null;
          const parts = chunkWords
            .filter(
              (word) =>
                word.chunkStart >= line.start && word.chunkStart < line.start + line.text.length,
            )
            .map((word) => {
              const seg =
                segments.find(
                  (s) => s.start <= word.chunkStart && word.chunkEnd <= s.end,
                ) ?? null;
              return {
                index: word.index,
                text: md.slice(word.chunkStart, word.chunkEnd),
                style: seg?.style ? inlineStyles[seg.style] : undefined,
              };
            });
          return { marker, skip: span.kind === 'table' && TABLE_SEPARATOR.test(line.text), parts };
        });

        return { container, textStyle, lines };
      });
    function lines0(md: string, start: number, end: number) {
      const out: { start: number; text: string }[] = [];
      let pos = start;
      for (const text of md.slice(start, end).split('\n')) {
        out.push({ start: pos, text });
        pos += text.length + 1;
      }
      return out;
    }
  }, [md, plan, chunkIndex, ink.foreground, mdStyles, inlineStyles]);

  const highlight: TextStyle = {
    backgroundColor: ink.primary,
    color: ink.primaryForeground,
    borderRadius: 4,
  };

  return (
    <View>
      {blocks.map((block, bi) => (
        <View key={bi} style={block.container}>
          {block.lines.map((line, li) =>
            line.skip ? null : (
              <Text key={li} style={block.textStyle}>
                {line.marker ? (
                  <Text style={mdStyles.list_item_bullet_marker}>{line.marker} </Text>
                ) : null}
                {line.parts.map((part, pi) => (
                  <Text
                    key={pi}
                    style={
                      part.index === activeWordIndex ? [part.style, highlight] : part.style
                    }>
                    {part.text}
                    {pi < line.parts.length - 1 ? ' ' : null}
                  </Text>
                ))}
              </Text>
            ),
          )}
        </View>
      ))}
    </View>
  );
};
