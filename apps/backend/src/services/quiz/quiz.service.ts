import { prisma } from "@/prisma";
import { CreateQuestionInputDto, CreateQuestionOutputDto } from "./dto/CreateQuestion.dto";
import { CreateAnswerInputDto, CreateAnswerOutputDto } from "./dto/CreateAnswer.dto";

const createQuestion = async (input: CreateQuestionInputDto): Promise<CreateQuestionOutputDto> => {
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
}

const createAnswer = async (input: CreateAnswerInputDto): Promise<CreateAnswerOutputDto> => {
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
}

export default { createQuestion };