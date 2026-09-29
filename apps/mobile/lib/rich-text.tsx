import { type ReactNode } from 'react';
import { Platform, Text as RNText, type TextStyle } from 'react-native';
import { highlightSpans, type Scheme } from '@/lib/code-highlight';

const MONO = Platform.select({ ios: 'Courier New', default: 'monospace' });

export type CodeSegmentOptions = {
  /** Chip + font sizing for the host context (nested Text inherits size otherwise). */
  style?: TextStyle;
  /**
   * Skip token colors — monochrome mono chip. Used on inverted/solid surfaces
   * (selected option tile, answer blocks) where palette colors lose contrast.
   */
  monochrome?: boolean;
};

/**
 * Render a string that may contain `` `inline code` `` spans as Text children:
 * prose verbatim, code as a mono chip whose content is syntax-highlighted with
 * the TypeScript grammar (quiz prose quotes JS/TS-style identifiers; other
 * languages fall through to mostly-plain coloring, which is harmless).
 * Unpaired backticks render literally.
 */
export const codeSegments = (
  text: string,
  scheme: Scheme,
  options: CodeSegmentOptions = {}
): ReactNode[] =>
  text.split(/(`[^`\n]+`)/g).map((part, index) => {
    if (part.length < 2 || !part.startsWith('`') || !part.endsWith('`')) return part;
    const code = part.slice(1, -1);
    return (
      <RNText
        key={index}
        style={[
          {
            fontFamily: MONO,
            backgroundColor: 'rgba(128,128,128,0.24)',
            borderRadius: 4,
            paddingHorizontal: 4,
          },
          options.style,
        ]}>
        {options.monochrome ? code : highlightSpans(code, 'typescript', scheme)}
      </RNText>
    );
  });
