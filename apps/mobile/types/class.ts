import rpc from '@/utils/rpc';
import type { z } from 'zod';
import { schema } from '@axon/api-contract';

export type Class = Awaited<ReturnType<typeof rpc.class.list>>[0];

/** One embedded lesson clip: a model-selected segment of a YouTube video. */
export type ClassVideoClip = z.infer<typeof schema.class.GetClassByIdOutput>['videoClips'][number];

/** class.get response; skillId arrives with the adaptive-loop contract. */
export interface ClassById {
  id: number;
  skillId: number;
  title: string;
  contentMd: string;
  /** Lesson base speech language (BCP-47); null for pre-tagging lessons. */
  baseLanguage?: string | null;
  /** Video enrichment: PENDING gates the lesson, SKIPPED renders plain. */
  clipStatus?: 'PENDING' | 'READY' | 'SKIPPED';
  videoClips?: ClassVideoClip[];
}

/** class.qa.list item: one Q&A block anchored at a top-level conspect chunk. */
export type ClassQaBlock = z.infer<typeof schema.class.ListClassQaOutput>[number];

/** class.qa.ask result: the server block id, still PENDING at return time. */
export type ClassQaAskResult = z.infer<typeof schema.class.AskClassQuestionOutput>;
