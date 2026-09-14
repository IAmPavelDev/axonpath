import { prisma } from "@/prisma";
import {
  CreateSkillInputDto,
  CreateSkillOutputDto,
} from "./dto/CreateSkill.dto";
import { Prisma, SkillStatus } from "@/prisma/generated";
import {
  GetSkillsListInputDto,
  GetSkillsListOutputDto,
} from "./dto/GetSkillsList.dto";
import { EditSkillOutputDto, EditSkillInputDto } from "./dto/EditSkill.dto";
import {
  GetSkillByIdInputDto,
  GetSkillByIdOutputDto,
} from "./dto/GetSkillById.dto";

const createSkill = async (
  input: CreateSkillInputDto,
): Promise<CreateSkillOutputDto> => {
  const { topic, userId } = input;
  const skill = await prisma.skill.create({
    data: {
      topic,
      userId,
      status: SkillStatus.DRAFT,
    },
    select: {
      id: true,
      status: true,
    },
  });
  return skill;
};

const update = async (
  input: EditSkillInputDto,
): Promise<EditSkillOutputDto> => {
  const { id, topic, description } = input;

  const data: Partial<Pick<EditSkillInputDto, 'topic' | 'description'>> = {};
  if (topic !== undefined) data.topic = topic;
  if (description !== undefined) data.description = description;

  const where = { id };
  const select = {
    id: true,
    status: true,
  } satisfies Prisma.SkillSelect;

  const skill =
    Object.keys(data).length > 0
      ? await prisma.skill.update({ where, data, select })
      : await prisma.skill.findUniqueOrThrow({ where, select });

  return skill;
};

const getSkillById = async (
  input: GetSkillByIdInputDto,
): Promise<GetSkillByIdOutputDto | null> => {
  const skill = await prisma.skill.findFirst({
    where: input,
    select: {
      id: true,
      topic: true,
      description: true,
      status: true,
    },
  });
  return skill;
};

const getSkillsList = async (
  input: GetSkillsListInputDto,
): Promise<GetSkillsListOutputDto> => {
  const skills = await prisma.skill.findMany({
    where: {
      userId: input.userId,
    },
    select: {
      id: true,
      topic: true,
      description: true,
      status: true,
      userId: true,
      lambda: true,
      requestId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return { skills };
};

export default {
  createSkill,
  update,
  getSkillById,
  getSkillsList,
};
