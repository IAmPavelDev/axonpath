import { SkillMode, SkillStatus } from "@/prisma/generated";
import type { NextClassJobRepository } from "@/modules/jobs/next-class-job.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";

export type NextClassReconcilerDeps = {
  skillRepo: SkillRepository;
  classRepo: ClassRepository;
  quizRepo: QuizRepository;
  nextClassJobs: NextClassJobRepository;
};

/** One reconciliation pass over every learnable skill. */
export type NextClassReconciler = () => Promise<void>;

/**
 * The cron's safety net. submit-quiz normally arms the durable marker, but a
 * signal can still be lost (crash between persist and enqueue, a marker
 * dropped after its final retry). Each tick walks the ACTIVE skills and
 * re-arms any whose learner has answered through the newest class while no
 * marker exists and no generation is in flight:
 *   - no class yet            → skip (init lifecycle owns the status)
 *   - newest class unanswered → skip (learner still working through it)
 *   - marker PENDING/PROCESSING → skip (already queued or generating)
 * run. The next-class pipeline settles the status back to ACTIVE. MANUAL
 * skills are skipped entirely — their lessons come from learner-chosen
 * targets, never from the safety net.
 */
export const makeNextClassReconciler =
  ({ skillRepo, classRepo, quizRepo, nextClassJobs }: NextClassReconcilerDeps) =>
  async (): Promise<void> => {
    const skills = await skillRepo.listByStatus(SkillStatus.ACTIVE);

    for (const skill of skills) {
      // MANUAL skills never self-continue: the learner composes the next
      // lesson from candidate directions, so the safety net must not re-arm
      // them. (Their create-class markers are armed deliberately.)
      if (skill.mode === SkillMode.MANUAL) {
        continue;
      }
      const last = await classRepo.findTopBySkill(skill.id);
      if (!last) {
        continue;
      }

      const answeredIndex = await quizRepo.findHighestAnsweredClassIndex(
        skill.id,
        skill.userId,
      );
      // "All lessons submitted": the learner has answered through the newest
      // class, so no untouched lesson remains and the next one is expected.
      if (answeredIndex === null || answeredIndex < last.index) {
        continue;
      }

      // A marker means the normal pipeline already owns this skill — the
      // submit path armed it, or a run is in flight. Never double-arm, and
      // never touch a skill whose phase is already GENERATING.
      if (await nextClassJobs.existsPending(skill.id)) {
        continue;
      }

      await nextClassJobs.enqueue({ skillId: skill.id, userId: skill.userId });
      await skillRepo.update(skill.id, { status: SkillStatus.GENERATING });
    }
  };
