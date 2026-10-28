import type { z } from "zod";
import * as skillSchema from "./schema/skill.schema.js";
import * as classSchema from "./schema/class.schema.js";
import * as authSchema from "./schema/auth.schema.js";
import * as quizSchema from "./schema/quiz.schema.js";
import * as statsSchema from "./schema/stats.schema.js";
import * as videoSchema from "./schema/video.schema.js";
import { type Question } from "./schema/quiz.schema.js";
import { ROUTES, type RouteDef, type ApiMethod } from "./routes.js";

export const schema = {
  skill: skillSchema,
  class: classSchema,
  quiz: quizSchema,
  auth: authSchema,
  stats: statsSchema,
  video: videoSchema
}

export type { Question };

/** Named result contract for quiz submission — owned here, consumed by clients. */
export type SubmitQuizAnswersOutput = z.infer<typeof quizSchema.SubmitQuizAnswersOutput>;

/** Declarative route table: backend registration + OpenAPI emission consume it. */
export { ROUTES, type RouteDef, type ApiMethod };
