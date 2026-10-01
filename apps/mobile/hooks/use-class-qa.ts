import rpc from '@/utils/rpc';
import type { ClassQaAskResult, ClassQaBlock } from '@/types/class';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Optimistic placeholder: created at submit time, retired once the poll returns `blockId`. */
export type TempQaBlock = {
  tempId: number;
  anchorParagraph: number;
  question: string;
  /** Verbatim selection at ask time; null when anchored by tap only. */
  anchorText: string | null;
  /** Server id once ask() resolves; null until then. */
  blockId: number | null;
  /** ask() itself failed (network/offline) — the temp offers retry. */
  failed: boolean;
};

export type QaRenderItem =
  | { key: string; kind: 'server'; block: ClassQaBlock }
  | { key: string; kind: 'temp'; temp: TempQaBlock };

const POLL_MS = 1600;

/**
 * Q&A blocks for a class conspect. React Query defaults stay active (no
 * global queryClient config in this app); polling is enabled only while any
 * block is PENDING, per the backend contract. Optimistic temp blocks make the
 * new card appear at t=0 and are retired by server id on the next list tick.
 * The verbatim selection rides along (Phase 8) so the backend can ground the
 * answer on exactly the passage the learner selected.
 */
export function useClassQa(classId: number) {
  const queryClient = useQueryClient();
  const [tempBlocks, setTempBlocks] = useState<TempQaBlock[]>([]);
  const tempSeq = useRef(0);

  const listQuery = useQuery({
    queryKey: ['classQa', classId],
    queryFn: () => rpc.class.qa.list({ classId }),
    refetchInterval: (query) =>
      query.state.data?.some((b) => b.status === 'PENDING') ? POLL_MS : false,
  });

  // Retire temps whose server block has arrived (any status) — the list
  // snapshot takes over rendering for that question.
  useEffect(() => {
    const data = listQuery.data;
    if (!data) return;
    setTempBlocks((temps) => {
      const alive = temps.filter(
        (t) => t.blockId === null || !data.some((b) => b.id === t.blockId)
      );
      return alive.length === temps.length ? temps : alive;
    });
  }, [listQuery.data]);

  const askRequest = useCallback(
    (anchorParagraph: number, question: string, anchorText: string | null, tempId: number) =>
      rpc.class.qa
        .ask({
          classId,
          anchorParagraph,
          question,
          ...(anchorText !== null && anchorText.length > 0 ? { anchorText } : {}),
        })
        .then((res: ClassQaAskResult) => {
          setTempBlocks((t) =>
            t.map((x) => (x.tempId === tempId ? { ...x, blockId: res.blockId } : x))
          );
          // Pull the list now instead of waiting for a PENDING-driven tick.
          return queryClient.invalidateQueries({ queryKey: ['classQa', classId] });
        })
        .catch(() => {
          setTempBlocks((t) => t.map((x) => (x.tempId === tempId ? { ...x, failed: true } : x)));
        }),
    [classId, queryClient]
  );

  const ask = useCallback(
    (anchorParagraph: number, question: string, anchorText: string | null = null): number => {
      const tempId = ++tempSeq.current;
      setTempBlocks((t) => [
        ...t,
        { tempId, anchorParagraph, question, anchorText, blockId: null, failed: false },
      ]);
      void askRequest(anchorParagraph, question, anchorText, tempId);
      return tempId;
    },
    [askRequest]
  );

  /** Retry a temp whose ask() call failed — same entry, fresh request. */
  const retryTemp = useCallback(
    (tempId: number) => {
      const temp = tempBlocks.find((t) => t.tempId === tempId);
      if (!temp) return;
      setTempBlocks((t) => t.map((x) => (x.tempId === tempId ? { ...x, failed: false } : x)));
      void askRequest(temp.anchorParagraph, temp.question, temp.anchorText, tempId);
    },
    [askRequest, tempBlocks]
  );

  /** Re-ask after a terminal FAILED server block: new request, new block. */
  const askAgain = useCallback(
    (block: ClassQaBlock) => ask(block.anchorParagraph, block.question, block.anchorText),
    [ask]
  );

  // Document order: chunks ascend by index; within a chunk the server list is
  // already (createdAt, id)-sorted, temps are strictly newer than servers.
  const blocksByAnchor = useMemo(() => {
    const map = new Map<number, QaRenderItem[]>();
    const push = (anchor: number, item: QaRenderItem) => {
      const arr = map.get(anchor);
      if (arr) arr.push(item);
      else map.set(anchor, [item]);
    };
    for (const block of listQuery.data ?? []) {
      push(block.anchorParagraph, { key: `s${block.id}`, kind: 'server', block });
    }
    for (const temp of tempBlocks) {
      push(temp.anchorParagraph, { key: `t${temp.tempId}`, kind: 'temp', temp });
    }
    return map;
  }, [listQuery.data, tempBlocks]);

  return { listQuery, blocksByAnchor, ask, retryTemp, askAgain };
}
