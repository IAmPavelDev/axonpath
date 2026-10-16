import { chunkExcerpt, splitConspectChunks } from '@/lib/conspect-chunks';
import { ConspectMarkdown } from '@/lib/conspect-markdown';
import { HighlightedChunk } from '@components/class/HighlightedChunk';
import { stripLeadingH1, type SpeechPlan } from '@/lib/conspect-speech/word-map';
import type { QaRenderItem } from '@/hooks/use-class-qa';
import type { ClassQaBlock } from '@/types/class';
import { VideoPlayerCard } from '@components/video/VideoPlayerCard';
import { QaBlock } from '@components/class/QaBlock';
import { Fragment, FC, useMemo } from 'react';
import { Text, TouchableWithoutFeedback, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

/** One embedded lesson clip, keyed by its conspect chunk. */
export type ConspectClip = {
  videoId: string;
  title: string;
  channel: string;
  startSeconds: number;
  endSeconds: number;
};

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
  /** Lesson video clips grouped by anchorParagraph (client chunk index). */
  clipsByAnchor?: Map<number, ConspectClip>;
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
  /** Speech state: the word currently being spoken, if read-aloud is on. */
  speechView?: { plan: SpeechPlan; activeWordIndex: number };
};

/**
 * The conspect reader: renders the lesson as top-level chunks and interleaves
 * QA groups and video clips at their anchors.
 */
export const ClassConspect: FC<Props> = ({
  contentMd: raw,
  anchorMode = false,
  onAnchorChunk,
  qaByAnchor,
  clipsByAnchor,
  animateInsertions = false,
  onRegisterChunkLayout,
  onRegisterQaLayout,
  onFollowUp,
  onRetryTemp,
  onAskSelection,
  onAskAgain,
  speechView,
}) => {
  // The screen header already carries the lesson title; a leading h1 in
  // the body would repeat it.
  const contentMd = stripLeadingH1(raw);
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

  // Only the chunk being spoken renders through the highlight-aware path.
  const activeChunk =
    speechView && speechView.activeWordIndex >= 0
      ? (speechView.plan.words[speechView.activeWordIndex]?.chunk ?? -1)
      : -1;

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

  const renderClip = (index: number) => {
    const clip = clipsByAnchor?.get(index);
    return clip ? (
      <View className="pt-3">
        <VideoPlayerCard
          videoId={clip.videoId}
          title={clip.title}
          channel={clip.channel}
          startSeconds={clip.startSeconds}
          endSeconds={clip.endSeconds}
        />
      </View>
    ) : null;
  };

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
                {i === activeChunk && speechView ? (
                  <HighlightedChunk
                    md={chunk}
                    plan={speechView.plan}
                    chunkIndex={i}
                    activeWordIndex={speechView.activeWordIndex}
                  />
                ) : (
                  <ConspectMarkdown
                    md={chunk}
                    disableLinks={anchorMode}
                    selectionAsk={
                      onAskSelection ? { onSelect: (text) => onAskSelection(i, text) } : undefined
                    }
                  />
                )}
              </View>
            </TouchableWithoutFeedback>
          </Animated.View>
          {renderClip(i)}
          {renderQaGroup(i, qaByAnchor?.get(i), chunkExcerpt(chunk))}
        </Fragment>
      ))}
      {renderQaGroup(-1, tailGroups, 'Earlier conversation in this lesson')}
    </View>
  );
};
