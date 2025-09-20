import { getQuizHandler } from "@/controllers/quiz.controller";
import { rpc } from "@/lib/orpc";

const get = rpc.quiz.get.handler(getQuizHandler);

export const quizRouter = {
  get,
};
