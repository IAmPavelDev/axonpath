import { createSkillHandler } from './create.ts';
import { generateQuestionsHandler } from './generateQuestions.ts';
import { getSkillByIdHandler } from './getById.ts';
import { getSkillClassesHandler } from './getClasses.ts';
import { getNextClassStatusHandler } from './getNextClassStatus.ts';
import { getSkillQuestionsHandler } from './getQuestions.ts';
import { getSkillProgressHandler } from './getSkillProgress.ts';
import * as schema from './schema.ts';
import { submitAnswersHandler } from './submitAnswers.ts';

export default {
  schema,
  createSkillHandler,
  getSkillByIdHandler,
  getSkillClassesHandler,
  getSkillQuestionsHandler,
  submitAnswersHandler,
  getNextClassStatusHandler,
  getSkillProgressHandler,
  generateQuestionsHandler,
};
