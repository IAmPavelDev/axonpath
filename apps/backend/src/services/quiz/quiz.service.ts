import { prisma } from "@/prisma";
import {
  CreateQuestionInputDto,
  CreateQuestionOutputDto,
} from "./dto/CreateQuestion.dto";
import {
  CreateAnswerInputDto,
  CreateAnswerOutputDto,
} from "./dto/CreateAnswer.dto";
import {
  GetQuestionsByClassIdInputDto,
  GetQuestionsByClassIdOutputDto,
} from "./dto/GetQuestionsByClassId.dto";
import { SubmitQuizAnswersInputDto, SubmitQuizAnswersOutputDto } from "./dto/SubmitAnswer.dto";

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

const createAnswer = async (
  input: CreateAnswerInputDto
): Promise<CreateAnswerOutputDto> => {
  const answer = await prisma.answer.create({
    data: {
      questionId: input.questionId,
      userId: input.userId,
      content: input.content,
      score: input.score,
      isCorrect: input.isCorrect,
      timeSpentMs: input.timeSpentMs,
      device: input.device,
    },
    select: {
      id: true,
    },
  });

  return { answerId: answer.id };
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

  return { questions } as GetQuestionsByClassIdOutputDto;
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

  return { questions };
};

export default { createQuestion, getQuestionsByClassId };
