import { chunkExcerpt, splitConspectChunks } from '@/lib/conspect-chunks';
import { ConspectMarkdown } from '@/lib/conspect-markdown';
import type { QaRenderItem } from '@/hooks/use-class-qa';
import { QaBlock } from '@components/class/QaBlock';
import { Fragment, FC, useMemo } from 'react';
import { Text, TouchableWithoutFeedback, View } from 'react-native';

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
  /** Layout bookkeeping so the parent can scroll a fresh block into view. */
  onRegisterChunkLayout?: (index: number, y: number) => void;
  onRegisterQaLayout?: (index: number, y: number) => void;
  onFollowUp?: (anchorParagraph: number, excerpt: string) => void;
  onRetryTemp?: (tempId: number) => void;
  onAskAgain?: (anchorParagraph: number, question: string) => void;
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
  onRegisterChunkLayout,
  onRegisterQaLayout,
  onFollowUp,
  onRetryTemp,
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

  // A QA group renders only when it has blocks; its y offset is what the
  // parent scrolls to when a fresh block is inserted.
  const renderQaGroup = (anchor: number, items: QaRenderItem[] | undefined, excerpt: string) =>
    items?.length ? (
      <View
        onLayout={(e) => onRegisterQaLayout?.(anchor, e.nativeEvent.layout.y)}
        accessibilityLabel="Questions and answers about this passage">
        {items.map((item) => (
          <QaBlock
            key={item.key}
            item={item}
            excerpt={excerpt}
            onFollowUp={onFollowUp ?? (() => {})}
            onRetryTemp={onRetryTemp ?? (() => {})}
            onAskAgain={onAskAgain ?? (() => {})}
          />
        ))}
      </View>
    ) : null;

  return (
    <View>
      {chunks.map((chunk, i) => (
        <Fragment key={i}>
          <View onLayout={(e) => onRegisterChunkLayout?.(i, e.nativeEvent.layout.y)}>
            <TouchableWithoutFeedback
              disabled={!anchorMode}
              accessibilityRole="button"
              accessibilityLabel={`Anchor your question to paragraph ${i + 1}`}
              onPress={() => onAnchorChunk?.(i, chunkExcerpt(chunk))}>
              <View>
                <ConspectMarkdown md={chunk} disableLinks={anchorMode} />
              </View>
            </TouchableWithoutFeedback>
          </View>
          {renderQaGroup(i, qaByAnchor?.get(i), chunkExcerpt(chunk))}
        </Fragment>
      ))}
      {renderQaGroup(-1, tailGroups, 'Earlier conversation in this lesson')}
    </View>
  );
};
