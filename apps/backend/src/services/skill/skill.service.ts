import { prisma } from "@/prisma";
import { CreateSkillInputDto, CreateSkillOutputDto } from "./dto/CreateSkill.dto";
import { SkillStatus } from "@/prisma/generated";
import { GetSkillsListInputDto, GetSkillsListOutputDto } from "./dto/GetSkillsList.dto";

const createSkill = async (input: CreateSkillInputDto): Promise<CreateSkillOutputDto> => {
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

const getSkillsList = async (input: GetSkillsListInputDto): Promise<GetSkillsListOutputDto> => {
  const skills = await prisma.skill.findMany({
    where: {
      userId: input.userId,
    },
  });

  return { skills };
};

export default {
  createSkill,
  getSkillsList
};
