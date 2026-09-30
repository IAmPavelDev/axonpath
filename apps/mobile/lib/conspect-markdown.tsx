import { Markdown, type RenderFunction } from 'react-native-markdown-x';
import { SelectableTextView } from '@rob117/react-native-selectable-text';
import { highlightSpans, resolveLanguage, type Scheme } from '@/lib/code-highlight';
import { FONTS, THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { FC, useMemo } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import FitImage from 'react-native-fit-image';

const MONO = Platform.select({ ios: 'Courier New', default: 'monospace' });
const SCREEN_WIDTH = Dimensions.get('window').width;

type ImageAttributes = { src: string; alt?: string };
type ImageNodeShape = { key: string; attributes: ImageAttributes };

/*
 * The conspect and the AI answer blocks share ONE rendering pipeline (styles +
 * render functions + <Markdown>): answers must look like the lesson they
 * annotate. Never fork these — extend them.
 */
export const makeStyles = (scheme: Scheme) => {
  const t = THEME[scheme];
  return {
    heading1: {
      fontFamily: FONTS.sansSemiBold,
      fontSize: 28,
      color: t.foreground,
      marginTop: 36,
      marginBottom: 14,
    },
    heading2: {
      fontFamily: FONTS.sansSemiBold,
      fontSize: 22,
      lineHeight: 30,
      color: t.foreground,
      marginTop: 30,
      marginBottom: 10,
    },
    heading3: {
      fontFamily: FONTS.sansSemiBold,
      fontSize: 18,
      lineHeight: 25,
      color: t.foreground,
      marginTop: 24,
      marginBottom: 8,
    },
    heading4: {
      fontFamily: FONTS.sansSemiBold,
      fontSize: 15,
      lineHeight: 21,
      color: t.foreground,
      marginTop: 20,
      marginBottom: 6,
    },
    heading5: {
      fontFamily: FONTS.sansSemiBold,
      fontSize: 14,
      color: t.foreground,
      marginTop: 18,
      marginBottom: 6,
    },
    heading6: {
      fontFamily: FONTS.sansSemiBold,
      fontSize: 13,
      color: t.mutedForeground,
      marginTop: 18,
      marginBottom: 6,
    },
    text: { fontFamily: FONTS.sansRegular, fontSize: 18, lineHeight: 30, color: t.foreground },
    textgroup: {},
    paragraph: { marginTop: 0, marginBottom: 16 },
    strong: { fontFamily: FONTS.sansSemiBold, color: t.foreground },
    em: { fontStyle: 'italic' as const, color: t.foreground },
    // Pull-quote: the rule marks "borrowed words", the face does the emphasis.
    blockquote: {
      backgroundColor: 'transparent',
      borderLeftWidth: 2,
      borderLeftColor: t.foreground,
      paddingLeft: 16,
      marginLeft: 2,
      marginVertical: 22,
      fontFamily: FONTS.sansMedium,
      fontSize: 20,
      lineHeight: 31,
      color: t.foreground,
    },
    list_item_bullet_marker: {
      marginLeft: 2,
      marginRight: 12,
      fontFamily: FONTS.sansRegular,
      fontSize: 18,
      lineHeight: 30,
      color: t.mutedForeground,
    },
    list_item_ordered_marker: {
      marginLeft: 2,
      marginRight: 12,
      fontFamily: FONTS.sansRegular,
      fontSize: 18,
      lineHeight: 30,
      color: t.mutedForeground,
    },
    hr: { backgroundColor: t.border, height: 1, marginVertical: 28 },
    link: { color: t.foreground, textDecorationLine: 'underline' as const },
    code_inline: {
      fontFamily: MONO,
      fontSize: 15,
      color: t.foreground,
      backgroundColor: t.muted,
      borderWidth: 0,
      borderRadius: 4,
      paddingVertical: 2,
      paddingHorizontal: 5,
    },
    fence: {
      fontFamily: MONO,
      fontSize: 14,
      lineHeight: 22,
      color: t.foreground,
      backgroundColor: t.muted,
      borderWidth: 0,
      borderRadius: 10,
      padding: 14,
      marginBottom: 16,
    },
    code_block: {
      fontFamily: MONO,
      fontSize: 14,
      lineHeight: 22,
      color: t.foreground,
      backgroundColor: t.muted,
      borderWidth: 0,
      borderRadius: 10,
      padding: 14,
      marginBottom: 16,
    },
    table: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: 8 },
    tr: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border },
    th: {
      flex: 1,
      padding: 8,
      fontFamily: FONTS.sansSemiBold,
      fontSize: 14,
      lineHeight: 20,
      color: t.foreground,
    },
    td: {
      flex: 1,
      padding: 8,
      fontFamily: FONTS.sansRegular,
      fontSize: 14,
      lineHeight: 20,
      color: t.foreground,
    },
  };
};

/*
 * Full-bleed figures: images break out of the text margins to the screen
 * edge (a magazine page-break), with the alt text set as a caption.
 */
const makeFigureStyles = (scheme: Scheme) => {
  const t = THEME[scheme];
  return StyleSheet.create({
    figure: {
      width: SCREEN_WIDTH,
      marginLeft: -24,
      marginRight: -24,
      marginVertical: 24,
    },
    image: {
      width: SCREEN_WIDTH,
    },
    caption: {
      fontFamily: FONTS.sansRegular,
      fontSize: 13,
      lineHeight: 19,
      color: t.mutedForeground,
      textAlign: 'center',
      marginTop: 10,
      paddingHorizontal: 24,
    },
  });
};

/*
 * Native selection-menu item for the "Ask AI" hook. Module-level constant so
 * the array identity (and thus the native prop) never churns across renders.
 */
const ASK_MENU = ['Ask AI'];

/** Long-press selection hook: prose paragraphs gain the native "Ask AI" item. */
export type SelectionAsk = { onSelect: (selectedText: string) => void };

export const makeRenderFunctions = (scheme: Scheme, ask?: SelectionAsk) => {
  // The library applies styles.text AFTER the inherited cascade, which
  // would flatten heading typography; flip the order so parent styles win.
  const text: RenderFunction = ({ Text, node, styles, inheritedStyles = {} }) => (
    <Text key={node.key} selectable style={[styles.text, inheritedStyles]}>
      {node.content}
    </Text>
  );

  /*
   * textgroup is the outermost <Text> of every paragraph/heading; Android
   * maps one native TextView per outermost Text, so `selectable` must live
   * here for long-press selection (incl. nested strong/em/code spans) to work.
   *
   * With `ask`, the paragraph is wrapped in a SelectableTextView whose native
   * hook targets exactly that one TextView, so the selection toolbar gains an
   * "Ask AI" item; the inner Text tree — rich spans included — is untouched.
   */
  const textgroup: RenderFunction = ({ Text, node, styles, children }) =>
    ask ? (
      <SelectableTextView
        key={node.key}
        menuOptions={ASK_MENU}
        onSelection={({ chosenOption, highlightedText }) => {
          if (chosenOption === ASK_MENU[0]) ask.onSelect(highlightedText);
        }}
        style={{ width: '100%' }}>
        <Text selectable style={styles.textgroup}>
          {children}
        </Text>
      </SelectableTextView>
    ) : (
      <Text key={node.key} selectable style={styles.textgroup}>
        {children}
      </Text>
    );

  const codeBlock: RenderFunction = ({ Text, node, styles, inheritedStyles = {} }) => {
    // We trim new lines off the end of code blocks because the parser sends an extra one.
    const { content } = node;
    const text =
      typeof content === 'string' && content.endsWith('\n') ? content.slice(0, -1) : content;

    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.code_block]}>
        {highlightSpans(text ?? '', resolveLanguage(node.sourceInfo), scheme)}
      </Text>
    );
  };

  const fence: RenderFunction = ({ Text, node, styles, inheritedStyles = {} }) => {
    // We trim new lines off the end of code blocks because the parser sends an extra one.
    const { content } = node;
    const text =
      typeof content === 'string' && content.endsWith('\n') ? content.slice(0, -1) : content;

    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.fence]}>
        {highlightSpans(text ?? '', resolveLanguage(node.sourceInfo), scheme)}
      </Text>
    );
  };

  // Inline spans: the TypeScript grammar is the best general guess for tutor
  // prose (hold(), setStatus(2)); non-TS snippets mostly stay plain, which is
  // the correct degrade.
  const codeInline: RenderFunction = ({ Text, node, styles, inheritedStyles = {} }) => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.code_inline]}>
      {highlightSpans(node.content ?? '', 'typescript', scheme)}
    </Text>
  );

  const image: RenderFunction = ({ node, styles, allowedImageHandlers, defaultImageHandler }) => {
    const { src, alt } = (node as unknown as ImageNodeShape).attributes;

    const isAllowedSource = allowedImageHandlers?.some((value) =>
      src.toLowerCase().startsWith(value.toLowerCase())
    );

    const uri = isAllowedSource ? src : defaultImageHandler ? `${defaultImageHandler}${src}` : null;

    if (!uri) return null;

    const figure = makeFigureStyles(scheme);

    return (
      <View key={node.key} style={figure.figure}>
        <FitImage
          indicator
          style={[styles.image, figure.image]}
          source={{ uri }}
          {...(alt ? { accessible: true, accessibilityLabel: alt } : {})}
        />
        {alt ? (
          <Text selectable style={figure.caption} accessibilityRole="text">
            {alt}
          </Text>
        ) : null}
      </View>
    );
  };

  return { image, textgroup, text, fence, code_block: codeBlock, code_inline: codeInline };
};

// Anchor-mode variant of the link rule: identical look, no Pressable, so a
// tap lands on the chunk (tap-to-anchor) instead of opening a URL.
const plainLink: RenderFunction = ({ Text, node, children, styles }) => (
  <Text key={node.key} style={styles.link}>
    {children}
  </Text>
);

export const ConspectMarkdown: FC<{
  md: string;
  disableLinks?: boolean;
  /** When set, prose paragraphs gain the native selection item "Ask AI". */
  selectionAsk?: SelectionAsk;
}> = ({ md, disableLinks = false, selectionAsk }) => {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const renderFunctions = useMemo(() => {
    const fns = makeRenderFunctions(scheme, selectionAsk);
    return disableLinks ? { ...fns, link: plainLink, blocklink: plainLink } : fns;
  }, [scheme, disableLinks, selectionAsk]);

  return (
    <Markdown styles={styles} renderFunctions={renderFunctions}>
      {md}
    </Markdown>
  );
};
