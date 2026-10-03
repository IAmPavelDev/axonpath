import { chunkExcerpt, splitConspectChunks } from '@/lib/conspect-chunks';
import { ConspectMarkdown } from '@/lib/conspect-markdown';
import type { QaRenderItem } from '@/hooks/use-class-qa';
import type { ClassQaBlock } from '@/types/class';
import { QaBlock } from '@components/class/QaBlock';
import { Fragment, FC, useMemo } from 'react';
import { Text, TouchableWithoutFeedback, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

type Props = {
  contentMd: string;
  /**
   * Anchor mode: every top-level conspect chunk becomes tap-to-anchor and
   * link taps are disabled, so a tap sets the QA anchor instead of opening
   * something else. Native long-press text selection still wins the gesture.
   */
  anchorMode?: boolean;
  onAnchorChunk?: (index: number, excerpt: string) => void;
  /** QA blocks grouped by anchorParagraph (client chunk index). */
  qaByAnchor?: Map<number, QaRenderItem[]>;
  /**
   * True for ~2s around an ask: conspect layout transitions run only inside
   * this window, so a fresh QA group slides its neighbors down seamlessly
   * while every unrelated reflow (tab flips, theme changes) stays instant.
   */
  animateInsertions?: boolean;
  /** Layout bookkeeping so the parent can scroll a fresh block into view. */
  onRegisterChunkLayout?: (index: number, y: number) => void;
  onRegisterQaLayout?: (index: number, y: number) => void;
  onFollowUp?: (anchorParagraph: number, excerpt: string) => void;
  /** Long-press "Ask AI" on selected text: (chunk index, selected text). */
  onAskSelection?: (index: number, selectedText: string) => void;
  onRetryTemp?: (tempId: number) => void;
  /** Restarts a FAILED server block in place — same id, same anchor. */
  onAskAgain?: (block: ClassQaBlock) => void;
};

/**
 * The conspect reader: renders the lesson as top-level chunks and interleaves
 * the Q&A blocks anchored after each chunk (document order: chunk, its QA
 * group, next chunk). Anchor indexes beyond the current chunk count (stale
 * server data) are appended after the last chunk so nothing disappears.
 */
export const ClassConspect: FC<Props> = ({
  contentMd: raw,
  anchorMode = false,
  onAnchorChunk,
  qaByAnchor,
  animateInsertions = false,
  onRegisterChunkLayout,
  onRegisterQaLayout,
  onFollowUp,
  onRetryTemp,
  onAskSelection,
  onAskAgain,
}) => {
  // The screen header already carries the lesson title; a leading h1 in
  // the body would repeat it.
  const contentMd = raw.replace(/^#[^\n]+\n+/, '');
  const chunks = useMemo(() => splitConspectChunks(contentMd), [contentMd]);

  // Stale anchors (server rows whose chunk no longer exists) render after
  // the last chunk, in stored order.
  const tailGroups = useMemo(
    () =>
      [...(qaByAnchor?.keys() ?? [])]
        .filter((anchor) => anchor >= chunks.length)
        .sort((a, b) => a - b)
        .flatMap((anchor) => qaByAnchor?.get(anchor) ?? []),
    [qaByAnchor, chunks.length]
  );

  // Layout transitions are only wired while `animateInsertions` is set.
  const chunkLayout = animateInsertions ? LinearTransition.duration(280) : undefined;
  const groupLayout = animateInsertions ? LinearTransition.duration(280) : undefined;
  const itemEntering = animateInsertions ? FadeInDown.duration(240) : undefined;

  // A QA group renders only when it has blocks; its y offset is what the
  // parent scrolls to when a fresh block is inserted.
  const renderQaGroup = (anchor: number, items: QaRenderItem[] | undefined, excerpt: string) =>
    items?.length ? (
      <Animated.View
        layout={groupLayout}
        onLayout={(e) => onRegisterQaLayout?.(anchor, e.nativeEvent.layout.y)}
        accessibilityLabel="Questions and answers about this passage">
        {items.map((item) => (
          <Animated.View key={item.key} entering={itemEntering} layout={groupLayout}>
            <QaBlock
              item={item}
              excerpt={excerpt}
              onFollowUp={onFollowUp ?? (() => {})}
              onRetryTemp={onRetryTemp ?? (() => {})}
              onAskAgain={onAskAgain ?? (() => {})}
            />
          </Animated.View>
        ))}
      </Animated.View>
    ) : null;

  return (
    <View>
      {chunks.map((chunk, i) => (
        <Fragment key={i}>
          <Animated.View
            layout={chunkLayout}
            onLayout={(e) => onRegisterChunkLayout?.(i, e.nativeEvent.layout.y)}>
            <TouchableWithoutFeedback
              disabled={!anchorMode}
              accessibilityRole="button"
              accessibilityLabel={`Anchor your question to paragraph ${i + 1}`}
              onPress={() => onAnchorChunk?.(i, chunkExcerpt(chunk))}>
              <View>
                <ConspectMarkdown
                  md={chunk}
                  disableLinks={anchorMode}
                  selectionAsk={
                    onAskSelection ? { onSelect: (text) => onAskSelection(i, text) } : undefined
                  }
                />
              </View>
            </TouchableWithoutFeedback>
          </Animated.View>
          {renderQaGroup(i, qaByAnchor?.get(i), chunkExcerpt(chunk))}
        </Fragment>
      ))}
      {renderQaGroup(-1, tailGroups, 'Earlier conversation in this lesson')}
    </View>
  );
};
