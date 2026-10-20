import { err, isErr, ok, type Result } from "@/modules/platform/result";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { VectorStorePort } from "@/modules/memory/ports";
import { logger } from "@/lib/logger";

export type DeleteSkillDeps = {
  skillRepo: SkillRepository;
  vectorStore: Pick<VectorStorePort, "deleteBySkill">;
};
export type DeleteSkillInput = {
  skillId: number;
  userId: number;
};
export type DeleteSkillOutput = { deleted: true };

export type DeleteSkillError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NotOwned"; skillId: number };

/**
 * Permanently delete a skill: lessons, questions, answers, progress, events,
 * and vector metadata all cascade away with it (DB FKs), and the FK-free
 * NextClassJob marker is dropped in the same transaction — a deleted skill can
 * never be re-armed by the sweeper/reconciler. Any generation still in flight
 * fails on the missing skill's FK (SkillNotFound), matching how the pipelines
 * already handle a vanished skill.
 *
 * Ownership is checked here (NotOwned maps to 404 so existence is not
 * leaked), and deletion is unconditional across statuses — any lifecycle
 * state can be removed. Qdrant cleanup rides AFTER the relational commit
 * (the embedding store cannot join the transaction): best-effort like vector
 * recording, because a missed point is retrieval noise, never data loss.
 */
export const makeDeleteSkill =
  ({ skillRepo, vectorStore }: DeleteSkillDeps) =>
  async (
    input: DeleteSkillInput,
  ): Promise<Result<DeleteSkillOutput, DeleteSkillError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: input.skillId });
    }

    await skillRepo.delete(input.skillId);

    const vectors = await vectorStore.deleteBySkill(input.skillId);
    if (isErr(vectors)) {
      logger.error(
        { skillId: input.skillId, error: vectors.error.detail },
        "Skill deleted; Qdrant cleanup failed",
      );
    }

    return ok({ deleted: true });
  };
