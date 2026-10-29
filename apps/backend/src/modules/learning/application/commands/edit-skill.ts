import { err, ok, type Result } from "@/modules/platform/result";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import {
  SKILL_FIRST_LESSON_JOB,
  type SkillFirstLessonJobPayload,
} from "@/modules/tutoring/application/generate-first-lesson";
import { drainCapped } from "./ensure-skill-lessons";

export type EditSkillDeps = {
  skillRepo: SkillRepository;
  classRepo: ClassRepository;
  jobs: JobQueuePort;
  /** Drain seam — the container's jobQueueIdle (see drainCapped). */
  awaitDrain: () => Promise<void>;
};
export type EditSkillInput = {
  id: number;
  userId: number;
  topic?: string;
  description?: string;
};
export type EditSkillOutput = {
  id: number;
  topic: string;
  description: string;
  status: string;
};

export type EditSkillError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number };

/**
 * Partial update of an editable skill's own fields (topic, description),
 * with the acceptance semantics of the create-with-prompt flow: editing a
 * lesson-less ACTIVE skill is the learner accepting the generated draft —
 * the saved fields become the generation brief and stage 2 (lesson 0) is
 * armed here by flipping the skill GENERATING and enqueueing the
 * skill-first-lesson job. The queue is then drained in-request (capped):
 * on the serverless API the frozen post-response queue would lose the job,
 * and without the drain the learner stares at an empty skill until the
 * worker's sweep recovers it minutes later. Every later edit (classes
 * exist) is a plain field update.
 *
 * Ownership is checked here (NotOwned maps to 404 so existence is not
 * leaked) — this endpoint writes learner-facing content and arms
 * generation, so it must not be callable cross-account.
 */
export const makeEditSkill =
  ({ skillRepo, classRepo, jobs, awaitDrain }: EditSkillDeps) =>
  async (
    input: EditSkillInput,
  ): Promise<Result<EditSkillOutput, EditSkillError>> => {
    const existing = await skillRepo.findById(input.id);
    if (!existing) {
      return err({ kind: "SkillNotFound", skillId: input.id });
    }
    if (existing.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.id });
    }

    const patch: { topic?: string; description?: string } = {};
    if (input.topic !== undefined) patch.topic = input.topic;
    if (input.description !== undefined) patch.description = input.description;

    if (Object.keys(patch).length === 0) {
      return ok({
        id: existing.id,
        topic: existing.topic,
        description: existing.description,
        status: existing.status,
      });
    }

    const isFirstAcceptance =
      existing.status === SkillStatus.ACTIVE &&
      (await classRepo.findTopBySkill(input.id)) === null;

    const updated = await skillRepo.update(input.id, {
      ...patch,
      ...(isFirstAcceptance ? { status: SkillStatus.GENERATING } : {}),
    });

    if (isFirstAcceptance) {
      jobs.enqueue(SKILL_FIRST_LESSON_JOB, {
        skillId: input.id,
        userId: input.userId,
      } satisfies SkillFirstLessonJobPayload);
      // On the serverless API the response's return freezes the in-process
      // queue — drain now (capped) so acceptance usually produces lesson 0
      // within this very request. The skill-init sweeper covers the overflow.
      await drainCapped(awaitDrain);
    }
    return ok({
      id: updated.id,
      topic: updated.topic,
      description: updated.description,
      status: updated.status,
    });
  };
