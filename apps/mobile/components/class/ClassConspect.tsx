import {
  
  Markdown,
  type RenderFunction,
} from 'react-native-markdown-x';
import { FONTS, THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { FC, useMemo } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import FitImage from 'react-native-fit-image';

const MONO = Platform.select({ ios: 'Courier New', default: 'monospace' });
const SCREEN_WIDTH = Dimensions.get('window').width;

type Scheme = 'light' | 'dark';

type ImageAttributes = { src: string; alt?: string };
type ImageNodeShape = { key: string; attributes: ImageAttributes };

const makeStyles = (scheme: Scheme) => {
  const t = THEME[scheme];
  return {
    heading1: {
      fontFamily: FONTS.serifSemiBold,
      fontSize: 28,
      color: t.foreground,
      marginTop: 36,
      marginBottom: 14,
    },
    heading2: {
      fontFamily: FONTS.serifSemiBold,
      fontSize: 22,
      lineHeight: 30,
      color: t.foreground,
      marginTop: 30,
      marginBottom: 10,
    },
    heading3: {
      fontFamily: FONTS.serifSemiBold,
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
    text: { fontFamily: FONTS.serifRegular, fontSize: 17, lineHeight: 29, color: t.foreground },
    textgroup: {},
    paragraph: { marginTop: 0, marginBottom: 16 },
    strong: { fontFamily: FONTS.serifSemiBold, color: t.foreground },
    em: { fontStyle: 'italic' as const, color: t.foreground },
    // Pull-quote: the rule marks "borrowed words", the face does the emphasis.
    blockquote: {
      backgroundColor: 'transparent',
      borderLeftWidth: 2,
      borderLeftColor: t.foreground,
      paddingLeft: 16,
      marginLeft: 2,
      marginVertical: 22,
      fontFamily: FONTS.serifMedium,
      fontSize: 20,
      lineHeight: 31,
      color: t.foreground,
    },
    list_item_bullet_marker: {
      marginLeft: 2,
      marginRight: 12,
      fontFamily: FONTS.serifRegular,
      fontSize: 17,
      lineHeight: 29,
      color: t.mutedForeground,
    },
    list_item_ordered_marker: {
      marginLeft: 2,
      marginRight: 12,
      fontFamily: FONTS.serifRegular,
      fontSize: 17,
      lineHeight: 29,
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

const makeRenderFunctions = (scheme: Scheme) => {
  // The library applies styles.text AFTER the inherited cascade, which
  // would flatten heading typography; flip the order so parent styles win.
  const text: RenderFunction = ({ Text, node, styles, inheritedStyles = {} }) => (
    <Text key={node.key} style={[styles.text, inheritedStyles]}>
      {node.content}
    </Text>
  );

  const image: RenderFunction = ({ node, styles, allowedImageHandlers, defaultImageHandler }) => {
    const { src, alt } = (node as unknown as ImageNodeShape).attributes;

    const isAllowedSource = allowedImageHandlers?.some((value) =>
      src.toLowerCase().startsWith(value.toLowerCase())
    );

    const uri = isAllowedSource  ? src  : (defaultImageHandler  ? `${defaultImageHandler}${src}`  : null);

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
          <Text style={figure.caption} accessibilityRole="text">
            {alt}
          </Text>
        ) : null}
      </View>
    );
  };

  return { image, text };
};

export const ClassConspect: FC<{ contentMd: string }> = ({ contentMd: raw }) => {
  // The screen header already carries the lesson title; a leading h1 in
  // the body would repeat it.
  const contentMd = raw.replace(/^#[^\n]+\n+/, "");
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const renderFunctions = useMemo(() => makeRenderFunctions(scheme), [scheme]);

  return (
    <Markdown styles={styles} renderFunctions={renderFunctions}>
      {contentMd}
    </Markdown>
  );
};
