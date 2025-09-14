import { OrpcHandler } from "@/types/OrpcHandler";
import z from "zod";
import { schema } from "@axon/api-contract";
import classService from "@/services/class/class.service";

const {
  GetClassListInput,
  GetClassListOutput,
  GetClassByIdInput,
  GetClassByIdOutput,
} = schema.class;

export const getClassListHandler: OrpcHandler<
  z.infer<typeof GetClassListInput>,
  z.infer<typeof GetClassListOutput>
> = async ({ input, context }) => {
  const { id: userId } = context.user;
  const classes = await classService.getClassesList(input.skillId, userId);
  return classes;
};

export const getClassByIdHandler: OrpcHandler<
  z.infer<typeof GetClassByIdInput>,
  z.infer<typeof GetClassByIdOutput>
> = async ({ input, context }) => {
  const { id: userId } = context.user;
  const classData = await classService.getClassById(input.id, userId);
  if (!classData) {
    throw new Error("Class not found");
  }
  return classData;
};
