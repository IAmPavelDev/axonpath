import { err, ok, type Result } from "@/modules/platform/result";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type {
  ClassQaEntity,
  ClassQaError,
} from "@/modules/learning/domain/class-qa/class-qa";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";

export type ListClassQaDeps = {
  classRepo: ClassRepository;
  skillRepo: SkillRepository;
  qaRepo: ClassQaRepository;
};

export type ListClassQaInput = { classId: number; userId: number };

/**
 * Q&A blocks for the conspect renderer, ascending (anchorParagraph, createdAt,
 * id): document order first, ask order breaking ties within one anchor.
 */
export const makeListClassQa =
  ({ classRepo, skillRepo, qaRepo }: ListClassQaDeps) =>
  async (
    input: ListClassQaInput,
  ): Promise<Result<ClassQaEntity[], ClassQaError>> => {
    const klass = await classRepo.findById(input.classId);
    if (!klass) {
      return err({ kind: "ClassNotFound", classId: input.classId });
    }

    const skill = await skillRepo.findById(klass.skillId);
    if (!skill) {
      return err({ kind: "ClassNotFound", classId: input.classId });
    }
    if (skill.userId !== input.userId) {
      return err({ kind: "NotOwned", skillId: skill.id });
    }

    return ok(await qaRepo.listByClass(input.classId));
  };
