import { ClassQaStatus, EventType } from "@/prisma/generated";
import { err, ok, type Result } from "@/modules/platform/result";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import type { AiPort } from "@/modules/tutoring/ports";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { RetrieveQaContext } from "@/modules/memory/application/retrieve-qa-context";
import type { ClassContentVectorsJobPayload } from "@/modules/memory/application/vectorize-class-content";
import { QA_BLOCK_VECTORS_JOB } from "@/modules/memory/application/mine-qa-vectors";
import { QA_TUTOR_SYSTEM } from "@/modules/tutoring/domain/personas";
import {
  buildQaAnswerPrompt,
  type QaHistoryEntry,
} from "@/modules/tutoring/domain/prompts";
import {
  conspectExcerpt,
  splitConspectChunks,
} from "@/modules/memory/domain/split-conspect";

/** Enqueued by ask-class-question right after the PENDING block is created. */
export const CLASS_QA_ANSWER_JOB = "class-qa-answer";

export type ClassQaAnswerJobPayload = { blockId: number };

/** History layer size — mirrors the prompt builder's own cap (Phase 8 D1). */
const QA_HISTORY_LIMIT = 5;

export type AnswerClassQuestionError =
  | { kind: "ClassNotFound"; classId: number }
  | { kind: "AiGenerationFailed"; detail?: string }
  | { kind: "AiResponseInvalid"; detail?: string };

export type AnswerClassQuestionDeps = {
  ai: AiPort;
  qaRepo: ClassQaRepository;
  classRepo: ClassRepository;
  skillRepo: SkillRepository;
  eventRepo: EventRepository;
  chatModel: string;
  retrieveQaContext: RetrieveQaContext;
  /** Degrade-ok inline backfill of a class's missing CONTENT_CHUNK vectors. */
  vectorizeClassContent: (
    input: ClassContentVectorsJobPayload,
  ) => Promise<Result<void, never>>;
  jobs: JobQueuePort;
};

/** The bound, dependency-complete use case — what the job registry consumes. */
export type AnswerClassQuestion = (
  input: ClassQaAnswerJobPayload,
) => Promise<Result<void, AnswerClassQuestionError>>;

/** Resolved anchor quote: the stored selection, else the anchored chunk's excerpt. */
const resolveAnchorExcerpt = (
  anchorText: string | null,
  chunks: string[],
  anchorParagraph: number,
): string | null => {
  if (anchorText !== null && anchorText.trim().length > 0) {
    return anchorText;
  }
  const chunk = chunks[anchorParagraph];
  return chunk === undefined ? null : conspectExcerpt(chunk, 300);
};

/**
 * Fill in the answer for a PENDING conspect question (Phase 8 D1): assemble
 * the layered prompt — question + verbatim selection (L1), the whole lesson
 * (L2), the class's prior answered Q&A as anchored annotations (L3), the
 * skill frame (L4), and similarity hits from the learner's memory (L5) —
 * then generate one grounded plain-text answer, persisted atomically as
 * ANSWERED (or FAILED — terminal, the learner re-asks to retry).
 *
 * Best-effort layers degrade silently: a missing selection falls back to the
 * anchored chunk's excerpt, empty history/memory layers are skipped, and
 * retrieval failure is just an empty layer — the answer always proceeds.
 * Before answering, the class's CONTENT_CHUNK vectors are lazily backfilled
 * (dedup inside the vectorizer; pre-Phase-8 classes converge to coverage on
 * first ask). A answered block is mined into QA_DERIVED memory via the
 * background miner job. Every terminal path settles the block: the class-qa
 * sweeper only re-enqueues blocks whose in-process job was lost to a
 * crash/restart (PENDING untouched for 2 minutes), never a block a completed
 * attempt left behind. Job replay (block already ANSWERED/FAILED or gone)
 * no-ops instead of double-charging the AI. Mirrors CLASS_GENERATED: the
 * full prompt+response is audited as QA_ANSWERED.
 */
export const makeAnswerClassQuestion =
  ({
    ai,
    qaRepo,
    classRepo,
    skillRepo,
    eventRepo,
    chatModel,
    retrieveQaContext,
    vectorizeClassContent,
    jobs,
  }: AnswerClassQuestionDeps): AnswerClassQuestion =>
  async (input) => {
    const block = await qaRepo.findById(input.blockId);
    if (!block || block.status !== ClassQaStatus.PENDING) {
      return ok(undefined);
    }

    const klass = await classRepo.findById(block.classId);
    if (!klass) {
      await qaRepo.markFailed(block.id);
      return err({ kind: "ClassNotFound", classId: block.classId });
    }
    const skill = await skillRepo.findById(klass.skillId);
    if (!skill) {
      await qaRepo.markFailed(block.id);
      return err({ kind: "ClassNotFound", classId: block.classId });
    }

    // Lazy CONTENT_CHUNK backfill — degrade-ok, dedup keyed per class inside.
    await vectorizeClassContent({ classId: klass.id });

    const chunks = splitConspectChunks(klass.contentMd);
    const anchorExcerpt = resolveAnchorExcerpt(
      block.anchorText,
      chunks,
      block.anchorParagraph,
    );

    const history: QaHistoryEntry[] = (
      await qaRepo.listAnsweredByClass(klass.id, QA_HISTORY_LIMIT)
    ).map((prior) => ({
      anchorExcerpt: resolveAnchorExcerpt(
        prior.anchorText,
        chunks,
        prior.anchorParagraph,
      ),
      question: prior.question,
      answer: prior.answer ?? "",
    }));

    const { skillHits, crossHits } = await retrieveQaContext({
      userId: block.userId,
      skillId: klass.skillId,
      query:
        block.anchorText !== null
          ? `${block.question}\n${block.anchorText}`
          : block.question,
    });

    const prompt = buildQaAnswerPrompt({
      lessonTitle: klass.title,
      skillTitle: skill.topic,
      skillDescription: skill.description,
      siblingTitles: (await classRepo.listBySkillByIndex(klass.skillId))
        .filter((sibling) => sibling.id !== klass.id)
        .map((sibling) => sibling.title),
      anchorParagraph: block.anchorParagraph,
      anchorExcerpt,
      question: block.question,
      contentMd: klass.contentMd,
      history,
      skillHits,
      crossHits,
    });

    const generation = await ai.generateText({
      system: QA_TUTOR_SYSTEM,
      prompt,
    });
    if (!generation.ok) {
      await qaRepo.markFailed(block.id);
      return { ok: false, error: generation.error };
    }

    const answer = generation.value.raw.trim();
    if (answer.length === 0) {
      await qaRepo.markFailed(block.id);
      return {
        ok: false,
        error: { kind: "AiResponseInvalid", detail: "empty completion" },
      };
    }

    await qaRepo.answer(block.id, { answer, aiModel: chatModel });

    // Memory mining (Phase 8 D5): the answered exchange becomes a
    // QA_DERIVED vector via the background miner — never load-bearing.
    jobs.enqueue(QA_BLOCK_VECTORS_JOB, { blockId: block.id });

    await eventRepo.record({
      skillId: klass.skillId,
      userId: block.userId,
      type: EventType.QA_ANSWERED,
      payload: {
        action: "class_qa",
        blockId: block.id,
        classId: klass.id,
        prompt,
        system: QA_TUTOR_SYSTEM,
        model: chatModel,
        response: answer,
        usage: generation.value.usage,
      },
    });

    return ok(undefined);
  };
