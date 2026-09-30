import type { AiEmbeddingUsage } from "@/modules/tutoring/ports";

/**
 * Attribute one batched embedding call's token usage across the vectors it
 * produced. The endpoint reports a single prompt-token count per batch; the
 * exact sum is preserved (floor per vector, remainder on the first). Absent
 * usage — the degrade path — yields nulls: tokenCount stays unknown, never
 * guessed.
 */
export const embeddingTokenCounts = (
  usage: AiEmbeddingUsage | undefined,
  count: number,
): (number | null)[] => {
  if (count === 0) return [];
  if (!usage) return Array.from({ length: count }, () => null);
  const base = Math.floor(usage.tokens / count);
  const remainder = usage.tokens - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
};
