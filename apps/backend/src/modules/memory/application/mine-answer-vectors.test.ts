import { describe, expect, it } from "vitest";
import {
  makeMineAnswerVectors,
  type MineAnswerVectorsDeps,
} from "./mine-answer-vectors";
import { err, ok } from "@/modules/platform/result";
import type {
  NewVector,
  VectorMetadataRepository,
} from "@/modules/memory/ports";
import type {
  AnswerWithQuestion,
  QuizRepository,
} from "@/modules/learning/domain/quiz/quiz.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { AiPort } from "@/modules/tutoring/ports";

const unused = async (): Promise<never> => {
  throw new Error("not used in miner tests");
};

const answer = (
  id: number,
  over: Partial<AnswerWithQuestion> = {},
): AnswerWithQuestion => ({
  answerId: id,
  questionId: id * 10,
  questionType: "MULTIPLE_CHOICE",
  questionText: `What does question ${id} test?`,
  answerKey: "A",
  userAnswer: "B",
  isCorrect: false,
  classId: 77,
  ...over,
});

/** Test seam: scriptable dedup + embedding failures, capturing recordVectors. */
const makeFakeDeps = (options: {
  minedAnswerIds?: number[];
  metadataFails?: boolean;
  embeddingsFail?: boolean;
  answers?: AnswerWithQuestion[];
  classes?: Array<{ id: number; index: number; title: string }>;
}) => {
  const recorded: NewVector[] = [];

  const vectorMetadata: VectorMetadataRepository = {
    sumTokenCountsByUser: async () => ({ totalTokens: 0, nullCount: 0 }),
    findAnswerIdsWithVectors: async () =>
      options.metadataFails
        ? err({ kind: "VectorStoreUnavailable", detail: "metadata down" })
        : ok(options.minedAnswerIds ?? []),
    findClassIdsWithVectors: async () => ok([]),
    findBlockIdsWithVectors: async () => ok([]),
  };
  const recordVectors = async (vectors: NewVector[]) => {
    recorded.push(...vectors);
    return ok(vectors.map((_, i) => i));
  };
  const quizRepo: QuizRepository = {
    findWrongAnswersBySkill: unused,
    findReviewCandidatesBySkill: unused,
    findAnswerActivityByUser: unused,
    findByClassId: unused,
    findScoreableByClassId: unused,
    createAnswers: unused,
    findAnswersByClassAndUser: unused,
    findHighestAnsweredClassIndex: unused,
    findAnswerStatsBySkill: unused,
    findAnswersWithQuestions: async () => options.answers ?? [],
    updateGrades: unused,
  };
  const classRepo: ClassRepository = {
    createWithQuestions: unused,
    findQuestionCountsByClassIds: unused,
    listBySkill: unused,
    listBySkillByIndex: unused,
    findTopBySkill: unused,
    findById: unused,
    listByIds: async () => options.classes ?? [{ id: 77, index: 2, title: "Outer joins" }],
  };
  const ai = {
    generateEmbeddings: async (content: string[]) =>
      options.embeddingsFail
        ? err({ kind: "AiGenerationFailed", detail: "embeddings down" })
        : ok({ embeddings: content.map(() => [0.1, 0.2, 0.3]) }),
    generateJson: unused,
    generateText: unused,
  } satisfies AiPort;

  const deps: MineAnswerVectorsDeps = {
    ai,
    vectorMetadata,
    recordVectors,
    quizRepo,
    classRepo,
  };
  return { deps, recorded };
};

describe("makeMineAnswerVectors", () => {
  const input = { skillId: 10, userId: 7, answerIds: [101, 102, 103] };

  it("mines one atomic third-person snippet per wrong class-attached answer", async () => {
    const { deps, recorded } = makeFakeDeps({
      answers: [
        answer(101),
        // Correct answers and class-less questions never become gaps.
        answer(102, { isCorrect: true }),
        answer(103, { classId: null }),
      ],
    });

    const result = await makeMineAnswerVectors(deps)(input);

    expect(result).toEqual(ok(undefined));
    expect(recorded).toEqual([
      {
        skillId: 10,
        userId: 7,
        classId: 77,
        classIndex: 2,
        source: "ANSWER_DERIVED",
        textSnippet:
          'Struggled with: What does question 101 test?. The learner answered "B"; the lesson\'s correct answer was "A" (Outer joins).',
        embedding: [0.1, 0.2, 0.3],
        tokenCount: null,
        answerId: 101,
      },
    ]);
  });

  it("never mines an answer twice — dedup runs before any work", async () => {
    const { deps, recorded } = makeFakeDeps({
      minedAnswerIds: [101, 103],
      answers: [answer(101), answer(103)],
    });

    const result = await makeMineAnswerVectors(deps)({
      skillId: 10,
      userId: 7,
      answerIds: [101, 103],
    });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toEqual([]);
  });

  it("degrades to ok with nothing recorded when embeddings fail", async () => {
    const { deps, recorded } = makeFakeDeps({
      embeddingsFail: true,
      answers: [answer(101)],
    });

    const result = await makeMineAnswerVectors(deps)(input);

    expect(result).toEqual(ok(undefined));
    expect(recorded).toEqual([]);
  });

  it("degrades to ok when the dedup metadata read fails", async () => {
    const { deps, recorded } = makeFakeDeps({
      metadataFails: true,
      answers: [answer(101)],
    });

    const result = await makeMineAnswerVectors(deps)(input);

    expect(result).toEqual(ok(undefined));
    expect(recorded).toEqual([]);
  });

  it("records nothing for empty input", async () => {
    const { deps, recorded } = makeFakeDeps({});

    const result = await makeMineAnswerVectors(deps)({
      skillId: 10,
      userId: 7,
      answerIds: [],
    });

    expect(result).toEqual(ok(undefined));
    expect(recorded).toEqual([]);
  });
});
