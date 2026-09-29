import { ClassQaStatus, EventType } from "@/prisma/generated";
import { err, ok, type Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import { QA_TUTOR_SYSTEM } from "@/modules/tutoring/domain/personas";
import { buildQaAnswerPrompt } from "@/modules/tutoring/domain/prompts";

/** Enqueued by ask-class-question right after the PENDING block is created. */
export const CLASS_QA_ANSWER_JOB = "class-qa-answer";

export type ClassQaAnswerJobPayload = { blockId: number };

export type AnswerClassQuestionError =
  | { kind: "ClassNotFound"; classId: number }
  | { kind: "AiGenerationFailed"; detail?: string }
  | { kind: "AiResponseInvalid"; detail?: string };

export type AnswerClassQuestionDeps = {
  ai: AiPort;
  qaRepo: ClassQaRepository;
  classRepo: ClassRepository;
  eventRepo: EventRepository;
  chatModel: string;
};

/** The bound, dependency-complete use case — what the job registry consumes. */
export type AnswerClassQuestion = (
  input: ClassQaAnswerJobPayload,
) => Promise<Result<void, AnswerClassQuestionError>>;

/**
 * Fill in the answer for a PENDING conspect question: one grounded,
 * plain-text generation over the lesson's contentMd, persisted atomically as
 * ANSWERED (or FAILED — terminal, the learner re-asks to retry). Every
 * terminal path settles the block: there is no sweeper for these jobs, so a
 * PENDING block must never survive a completed attempt. Job replay (block
 * already ANSWERED/FAILED or gone) no-ops instead of double-charging the AI.
 * Mirrors CLASS_GENERATED: the full prompt+response is audited as QA_ANSWERED.
 */
export const makeAnswerClassQuestion =
  ({
    ai,
    qaRepo,
    classRepo,
    eventRepo,
    chatModel,
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

    const prompt = buildQaAnswerPrompt({
      lessonTitle: klass.title,
      contentMd: klass.contentMd,
      question: block.question,
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
      },
    });

    return ok(undefined);
  };
