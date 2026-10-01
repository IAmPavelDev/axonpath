import { Skeleton } from '@atomics/skeleton';
import { Button } from '@atomics/button';
import { Text } from '@atomics/text';
import { ConspectMarkdown } from '@/lib/conspect-markdown';
import type { QaRenderItem } from '@/hooks/use-class-qa';
import { Sparkles } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { FC } from 'react';
import { Pressable, View } from 'react-native';

type Props = {
  item: QaRenderItem;
  /** Plain-text preview of the anchored conspect chunk — the visual anchor. */
  excerpt: string;
  onFollowUp: (anchorParagraph: number, excerpt: string) => void;
  onRetryTemp: (tempId: number) => void;
  onAskAgain: (anchorParagraph: number, question: string) => void;
};

/**
 * One flat Q&A card in the conspect flow. Question text (the user's own
 * words) renders at t=0; the answer area is a bounded skeleton while PENDING,
 * conspect-pipeline markdown once ANSWERED, or a dimmed retry state when
 * FAILED. Follow-ups are sibling blocks handled by the parent, never nesting.
 */
export const QaBlock: FC<Props> = ({ item, excerpt, onFollowUp, onRetryTemp, onAskAgain }) => {
  const { colorScheme } = useColorScheme();
  const dark = (colorScheme ?? 'light') === 'dark';

  const pending = item.kind === 'temp' ? !item.temp.failed : item.block.status === 'PENDING';
  const question = item.kind === 'temp' ? item.temp.question : item.block.question;
  const anchor = item.kind === 'temp' ? item.temp.anchorParagraph : item.block.anchorParagraph;
  // The stored verbatim selection wins over the chunk preview (Phase 8): the
  // card quotes exactly what the learner selected at ask time.
  const quote =
    (item.kind === 'temp' ? item.temp.anchorText : item.block.anchorText) ?? excerpt;

  const failedServer = item.kind === 'server' && item.block.status === 'FAILED';
  const failedTemp = item.kind === 'temp' && item.temp.failed;
  const dimmed = failedServer || failedTemp;

  return (
    <View
      className={`mb-4 rounded-lg border-hairline border-border bg-card p-4 ${dimmed ? 'opacity-60' : ''}`}
      accessibilityLabel={`Question about the passage: ${quote}`}>
      {/* Anchored quote: which passage this conversation belongs to. */}
      <View className="mb-2 flex-row items-start gap-1.5">
        <Sparkles size={13} color={dark ? 'hsl(213 94% 68%)' : 'hsl(221 83% 47%)'} />
        <Text
          numberOfLines={2}
          className="flex-1 font-sans-medium text-[13px] leading-[18px] text-muted-foreground">
          “{quote}”
        </Text>
      </View>

      {/* The user's words, visible immediately at t=0. */}
      <Text className="font-sans-semibold text-[16px] leading-[23px] text-card-foreground">
        {question}
      </Text>

      {pending ? (
        <View className="mt-3 gap-2" accessibilityLabel="Waiting for the AI answer">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </View>
      ) : failedTemp || failedServer ? (
        <View className="mt-3">
          <Text className="text-[14px] leading-[20px] text-destructive">
            The tutor couldn&apos;t answer this one.
          </Text>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 self-start px-0"
            onPress={() =>
              item.kind === 'temp'
                ? onRetryTemp(item.temp.tempId)
                : onAskAgain(anchor, item.block.question)
            }>
            <Sparkles size={14} color={dark ? 'hsl(213 94% 68%)' : 'hsl(221 83% 47%)'} />
            <Text className="font-sans-semibold text-[14px] text-primary">Try again</Text>
          </Button>
        </View>
      ) : item.kind === 'server' && item.block.status === 'ANSWERED' ? (
        <View className="mt-1">
          {/* Same pipeline as the conspect — never fork the answer rendering. */}
          <ConspectMarkdown md={item.block.answer ?? ''} />
          <Pressable
            className="mt-1 flex-row items-center gap-1.5 self-start rounded-md py-1 active:opacity-60"
            onPress={() => onFollowUp(anchor, excerpt)}
            accessibilityRole="button"
            accessibilityLabel="Ask a follow-up question">
            <Sparkles size={14} color={dark ? 'hsl(213 94% 68%)' : 'hsl(221 83% 47%)'} />
            <Text className="font-sans-semibold text-[14px] text-primary">Ask follow-up</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};
