import { prisma } from "@/prisma";
import {
  CreateQuestionInputDto,
  CreateQuestionOutputDto,
} from "./dto/CreateQuestion.dto";
import {
  GetQuestionsByClassIdInputDto,
  GetQuestionsByClassIdOutputDto,
} from "./dto/GetQuestionsByClassId.dto";
import { SubmitQuizAnswersInputDto, SubmitQuizAnswersOutputDto } from "./dto/SubmitAnswer.dto";
import { QuestionRow, toQuestionDto } from "./question.mapper";

const createQuestion = async (
  input: CreateQuestionInputDto
): Promise<CreateQuestionOutputDto> => {
  const question = await prisma.question.create({
    data: {
      skillId: input.skillId,
      classId: input.classId,
      type: input.type,
      text: input.text,
      choices: input.choices,
      answerKey: input.answerKey,
      aiModel: input.aiModel,
    },
    select: {
      id: true,
    },
  });

  return { questionId: question.id };
};

const getQuestionsByClassId = async (
  input: GetQuestionsByClassIdInputDto
): Promise<GetQuestionsByClassIdOutputDto> => {
  const questions = await prisma.question.findMany({
    where: {
      classId: input.classId,
    },
    select: {
      id: true,
      type: true,
      text: true,
      choices: true,
    },
  });

  return { questions: questions.map((row) => toQuestionDto(row as QuestionRow)) };
};

const submitAnswers = async (input: SubmitQuizAnswersInputDto): Promise<SubmitQuizAnswersOutputDto> => {
  const answers = input.answers;
  const questions = await prisma.question.findMany({
    where: {
      id: {
        in: answers.map(({ questionId }) => questionId),
      },
    },
    select: {
      id: true,
      type: true,
      text: true,
      choices: true,
    },
  });

  return { questions: questions.map((row) => toQuestionDto(row as QuestionRow)) };
};

export default { createQuestion, getQuestionsByClassId, submitAnswers };
