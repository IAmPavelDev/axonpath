import { err, ok, type Result } from "@/modules/platform/result";
import type { ClassError } from "@/modules/learning/domain/class/class";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { ClassListItem } from "@/modules/learning/domain/class/class";

export type GetClassListDeps = { classRepo: ClassRepository };
export type GetClassListOutput = ClassListItem[];

export const makeGetClassList =
  ({ classRepo }: GetClassListDeps) =>
  async (skillId: number, userId: number): Promise<GetClassListOutput> =>
    classRepo.listBySkill(skillId, userId);

export type GetClassByIdDeps = { classRepo: ClassRepository };
export type GetClassByIdInput = { classId: number };
export type GetClassByIdOutput = {
  id: number;
  skillId: number;
  title: string;
  contentMd: string;
  baseLanguage: string | null;
};

export const makeGetClassById =
  ({ classRepo }: GetClassByIdDeps) =>
  async (
    input: GetClassByIdInput,
  ): Promise<Result<GetClassByIdOutput, ClassError>> => {
    const found = await classRepo.findById(input.classId);

    if (!found) {
      return err({ kind: "ClassNotFound", classId: input.classId });
    }

    return ok(found);
  };
