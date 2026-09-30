import type {
  GradeOpenEnded,
  GradeOpenEndedJobPayload,
} from "@/modules/tutoring/application/grade-open-ended";

/**
 * The instant trigger for open-ended grading. The grader owns its degrade
 * policy internally (AI/parse failures become failed grades, never thrown),
 * so — like answer-memory mining — there is no error branch to log here.
 */
export const getGradeOpenEndedJobHandler = (gradeOpenEnded: GradeOpenEnded) => {
  return async (payload: GradeOpenEndedJobPayload) => {
    await gradeOpenEnded(payload);
  };
};
