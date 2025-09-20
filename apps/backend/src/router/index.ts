import { classRouter } from "./class.router"
import { quizRouter } from "./quiz.router"
import { skillRouter } from "./skill.router"

export const router = {
  skill: skillRouter,
  class: classRouter,
  quiz: quizRouter,
}