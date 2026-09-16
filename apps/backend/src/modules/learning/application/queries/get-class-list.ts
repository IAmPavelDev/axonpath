import { err, ok, type Result } from "@/modules/platform/result";
import type { ClassError } from "@/modules/learning/domain/class/class";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";

export type GetClassListDeps = { classRepo: ClassRepository };
export type GetClassListOutput = { id: number; title: string }[];

export const makeGetClassList =
  ({ classRepo }: GetClassListDeps) =>
  async (skillId: number): Promise<GetClassListOutput> =>
    classRepo.listBySkill(skillId);

export type GetClassByIdDeps = { classRepo: ClassRepository };
export type GetClassByIdInput = { classId: number };
export type GetClassByIdOutput = { id: number; title: string; contentMd: string };

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
