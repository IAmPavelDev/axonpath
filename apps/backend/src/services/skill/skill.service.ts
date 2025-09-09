import { prisma } from "@/prisma";
import { CreateSkillInputDto, CreateSkillOutputDto } from "./dto/CreateSkill.dto";
import { SkillStatus } from "@/prisma/generated";

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

export default {
  createSkill,
};
