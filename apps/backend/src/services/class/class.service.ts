import { prisma } from "@/prisma";
import {
  CreateClassInputDto,
  CreateClassOutputDto,
} from "./dto/CreateClass.dto";

const createClass = async (
  input: CreateClassInputDto
): Promise<CreateClassOutputDto> => {
  const classData = await prisma.class.create({
    data: {
      skillId: input.skillId,
      index: input.index,
      title: input.title,
      contentMd: input.contentMd,
      aiModel: input.aiModel,
    },
    select: {
      id: true,
    },
  });

  return { classId: classData.id };
};

const getClassesList = async (skillId: number, userId: number) => {
  const classes = await prisma.class.findMany({
    where: {
      skillId,
    },
    select: {
      id: true,
      title: true,
    },
  });

  return classes;
};

const getClassById = async (id: number, userId: number) => {
  const classData = await prisma.class.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      title: true,
      contentMd: true,
    },
  });

  return classData;
};

export default { createClass, getClassesList, getClassById };

