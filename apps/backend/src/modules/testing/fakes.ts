import { ok, type Result } from "@/modules/platform/result";
import type { Clock } from "@/modules/platform/ports/clock";
import { makeSystemClock } from "@/modules/platform/ports/clock";
import {
  ClassQaStatus,
  NextClassJobStatus,
  SkillStatus,
  VectorSource,
  type QuestionType,
} from "@/prisma/generated";
import type {
  AnswerReview,
  QuizRepository,
} from "@/modules/learning/domain/quiz/quiz.repository";
import { latestWrongPerQuestion } from "@/modules/learning/domain/quiz/latest-wrong";
import type { ReviewCandidate } from "@/modules/learning/domain/quiz/review-schedule";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type {
  DomainEvent,
  EventRepository,
} from "@/modules/learning/domain/event/event.repository";
import type {
  NewAnswer,
  NewQuestion,
  QuestionView,
  ScoreableQuestion,
} from "@/modules/learning/domain/quiz/question";
import type { JobQueuePort } from "@/modules/platform/ports/jobs";
import type { AiError, AiPort } from "@/modules/tutoring/ports";
import type {
  NewVector,
  SearchSimilarHit,
  VectorStoreError,
  VectorStorePort,
} from "@/modules/memory/ports";
import type { ClassQaEntity } from "@/modules/learning/domain/class-qa/class-qa";
import type {
  ClassQaRepository,
  NewClassQaBlock,
} from "@/modules/learning/domain/class-qa/class-qa.repository";
import { makeJobHandlers } from "@/modules/jobs/registry";
import { makeGenerateSkillMetadata } from "@/modules/tutoring/application/generate-skill-metadata";
import { makeGenerateFirstLesson } from "@/modules/tutoring/application/generate-first-lesson";
import { makeGenerateNextClass } from "@/modules/tutoring/application/generate-next-class";
import { makeAnswerClassQuestion } from "@/modules/tutoring/application/answer-class-question";
import { makeNextClassWorker } from "@/modules/jobs/next-class-worker";
import { makeMineAnswerVectors } from "@/modules/memory/application/mine-answer-vectors";
import { makeMineQaVectors } from "@/modules/memory/application/mine-qa-vectors";
import { makeVectorizeClassContent } from "@/modules/memory/application/vectorize-class-content";
import { makeRetrieveQaContext } from "@/modules/memory/application/retrieve-qa-context";
import { makeGradeOpenEnded } from "@/modules/tutoring/application/grade-open-ended";
import type {
  NextClassJobClaim,
  NextClassJobRepository,
} from "@/modules/jobs/next-class-job.repository";

/**
 * Deterministic in-memory backend for the composed loop integration test:
 * Map-backed repositories, a scripted AiPort, and a capturing JobQueuePort
 * whose handlers are invoked explicitly (no setImmediate timing).
 */
export type AiScript = {
  /** Stage-1 response: the generated title + description JSON. */
  metadataRaw?: string;
  initRaw?: string;
  nextRaw?: string;
  /** Grading response for open-ended submits; default grades nothing (degrade). */
  gradingRaw?: string;
  /** Plain-text answer for class Q&A; default is a one-liner. */
  qaAnswerRaw?: string;
  /** Fail the FIRST generateJson call with this schema name, then succeed. */
  failOnceOn?: string;
  /** Fail the FIRST generateEmbeddings call, then succeed. */
  failEmbeddingsOnce?: boolean;
  /** Prompt-token count the fake embedding endpoint reports (default: none). */
  embeddingTokens?: number;
};

/** Default grading response: an empty results array — the degrade path. */
const GRADING_RAW_DEFAULT = JSON.stringify({ results: [] });

/** Default scripted Q&A answer. */
const QA_ANSWER_RAW_DEFAULT =
  "A left join keeps every left row, matched or not.";


export type LoopHarness = {
  state: {
    skills: Map<
      number,
      {
        id: number;
        userId: number;
        topic: string;
        prompt: string;
        description: string;
        status: SkillStatus;
      }
    >;
    classes: Map<
      number,
      {
        id: number;
        skillId: number;
        index: number;
        title: string;
        contentMd: string;
        baseLanguage: string | null;
      }
    >;
    questions: Map<number, NewQuestion & { id: number }>;
    answers: (NewAnswer & { id: number; createdAt: Date })[];
    qaBlocks: ClassQaEntity[];
    events: DomainEvent[];
    vectors: NewVector[];
    enqueued: { jobName: string; payload: unknown }[];
    aiCalls: { schemaName: string; prompt: string }[];
  };
  deps: {
    ai: AiPort;
    recordAiAttempt: () => void;
    retrieveContext: (input: {
      userId: number;
      query: string;
      topK?: number;
      excludeSkillId?: number;
    }) => Promise<
      { textSnippet: string; source: string; classIndex: number | null }[]
    >;
    skillRepo: SkillRepository;
    classRepo: ClassRepository;
    quizRepo: QuizRepository;
    qaRepo: ClassQaRepository;
    eventRepo: EventRepository;
    recordVectors: (
      vectors: NewVector[],
    ) => Promise<Result<number[], VectorStoreError>>;
    chatModel: string;
    clock: Clock;
    jobs: JobQueuePort;
  };
  jobs: JobQueuePort;
  nextClassJobs: NextClassJobRepository;
  /** Drain the first enqueued job of the given name through its real handler. */
  runJob: (jobName: string) => Promise<unknown>;
};

const METADATA_RAW = JSON.stringify({
  title: "SQL Joins",
  description: "Learn SQL joins by doing.",
});

const INIT_JSON = JSON.stringify({
  classTitle: "SQL joins from zero",
  classContentMd: "## Introduction\nMeet the join.",
  baseLanguage: "en",
  contentLanguages: ["en"],
  lessonSummary:
    "This lesson introduced inner and left joins with small datasets.",
  questions: [
    {
      type: "TRUE_FALSE",
      text: "An INNER JOIN drops unmatched rows.",
      choices: ["True", "False"],
      answerKey: "True",
    },
  ],
  contextSnippets: ["First exposure to SQL joins"],
});

const NEXT_JSON = JSON.stringify({
  classTitle: "Joins deep dive",
  classContentMd: "## Introduction\nOuter joins in practice.",
  baseLanguage: "en",
  contentLanguages: ["en"],
  lessonSummary: "The learner practiced outer joins and result filtering.",
  questions: [
    {
      type: "MULTIPLE_CHOICE",
      text: "Which join keeps unmatched left rows?",
      choices: ["LEFT JOIN", "INNER JOIN"],
      answerKey: "LEFT JOIN",
    },
  ],
  contextSnippets: ["Struggled with LEFT JOIN basics"],
});

export const makeLoopHarness = (script: AiScript = {}): LoopHarness => {
  let failOnceConsumed = false;
  let embeddingsFailConsumed = false;

  let skillIdSeq = 0;
  let classIdSeq = 0;
  let questionIdSeq = 0;
  let answerIdSeq = 0;
  let qaBlockIdSeq = 0;

  const state = {
    skills: new Map<
      number,
      {
        id: number;
        userId: number;
        topic: string;
        prompt: string;
        description: string;
        status: SkillStatus;
      }
    >(),
    classes: new Map<
      number,
      {
        id: number;
        skillId: number;
        index: number;
        title: string;
        contentMd: string;
        baseLanguage: string | null;
      }
    >(),
    questions: new Map<number, NewQuestion & { id: number }>(),
    answers: [] as (NewAnswer & { id: number; createdAt: Date })[],
    qaBlocks: [] as ClassQaEntity[],
    events: [] as DomainEvent[],
    vectors: [] as NewVector[],
    enqueued: [] as { jobName: string; payload: unknown }[],
    aiCalls: [] as { schemaName: string; prompt: string }[],
  };

  const ai: AiPort = {
    generateJson: async (input, request) => {
      state.aiCalls.push({
        schemaName: request.schemaName,
        prompt: input.prompt,
      });
      if (script.failOnceOn === request.schemaName && !failOnceConsumed) {
        failOnceConsumed = true;
        const error: AiError = {
          kind: "AiGenerationFailed",
          detail: "scripted failure",
        };
        return { ok: false, error };
      }
      const raw =
        request.schemaName === "skill_metadata"
          ? (script.metadataRaw ?? METADATA_RAW)
          : request.schemaName === "init_skill"
            ? (script.initRaw ?? INIT_JSON)
            : request.schemaName === "next_class"
              ? (script.nextRaw ?? NEXT_JSON)
              : request.schemaName === "grading"
                ? (script.gradingRaw ?? GRADING_RAW_DEFAULT)
                : null;
      if (raw === null) {
        throw new Error(`unexpected schema ${request.schemaName}`);
      }
      return ok({ raw, usage: { promptTokens: 120, completionTokens: 80 } });
    },
    generateEmbeddings: async (content) => {
      if (script.failEmbeddingsOnce && !embeddingsFailConsumed) {
        embeddingsFailConsumed = true;
        const error: AiError = {
          kind: "AiGenerationFailed",
          detail: "embeddings down",
        };
        return { ok: false, error };
      }
      return ok({
        embeddings: content.map(() => [0.1, 0.2, 0.3]),
        usage:
          script.embeddingTokens !== undefined
            ? { tokens: script.embeddingTokens }
            : undefined,
      });
    },
    generateText: async (input) => {
      state.aiCalls.push({
        schemaName: "class_qa_answer",
        prompt: input.prompt,
      });
      return ok({
        raw: script.qaAnswerRaw ?? QA_ANSWER_RAW_DEFAULT,
        usage: { promptTokens: 120, completionTokens: 80 },
      });
    },
  };

  const retrieveContext: LoopHarness["deps"]["retrieveContext"] = async (
    input,
  ) =>
    state.vectors
      .filter(
        (vector) =>
          vector.userId === input.userId &&
          (input.excludeSkillId === undefined ||
            vector.skillId !== input.excludeSkillId),
      )
      .map((vector) => ({
        textSnippet: vector.textSnippet,
        source: vector.source as string,
        classIndex: vector.classIndex ?? null,
      }));

  const skillRepo: SkillRepository = {
    create: async (input) => {
      const id = ++skillIdSeq;
      state.skills.set(id, {
        id,
        userId: input.userId,
        topic: input.topic,
        prompt: input.prompt,
        description: "",
        status: input.status,
      });
      return { id, status: input.status };
    },
    update: async (id, patch) => {
      const skill = state.skills.get(id);
      if (!skill) {
        throw new Error(`skill ${id} not found`);
      }
      if (patch.topic !== undefined) skill.topic = patch.topic;
      if (patch.description !== undefined)
        skill.description = patch.description;
      if (patch.status !== undefined) skill.status = patch.status;
      return {
        id,
        topic: skill.topic,
        description: skill.description,
        status: skill.status,
      };
    },
    findById: async (id) => {
      const skill = state.skills.get(id);
      return skill
        ? {
            id: skill.id,
            topic: skill.topic,
            prompt: skill.prompt,
            description: skill.description,
            status: skill.status,
            userId: skill.userId,
          }
        : null;
    },
    listByUser: async () => [],
    listByStatus: async (status) =>
      [...state.skills.values()]
        .filter((skill) => skill.status === status)
        .map((skill) => ({
          id: skill.id,
          topic: skill.topic,
          description: skill.description,
          status: skill.status,
          userId: skill.userId,
          requestId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lessonCount: 0,
          completedLessons: 0,
          learnedPoints: 0,
          lastActivityAt: null,
        })),
    claimStaleInit: async () => {
      // No clock in the harness: every stuck GENERATING skill without
      // classes is claimable; tests control staleness via state setup.
      const claimed: Array<{
        id: number;
        userId: number;
        prompt: string;
        description: string;
      }> = [];
      for (const skill of state.skills.values()) {
        if (skill.status !== SkillStatus.GENERATING) continue;
        const hasClass = [...state.classes.values()].some(
          (cls) => cls.skillId === skill.id,
        );
        if (hasClass) continue;
        claimed.push({
          id: skill.id,
          userId: skill.userId,
          prompt: skill.prompt,
          description: skill.description,
        });
      }
      return claimed;
    },
    claimStaleFirstLesson: async () => {
      // Implicit-acceptance heal: lesson-less ACTIVE skills flip GENERATING
      // and are returned for the stage-2 requeue; tests pre-seed status.
      const accepted: Array<{ id: number; userId: number }> = [];
      for (const skill of state.skills.values()) {
        if (skill.status !== SkillStatus.ACTIVE) continue;
        const hasClass = [...state.classes.values()].some(
          (cls) => cls.skillId === skill.id,
        );
        if (hasClass) continue;
        skill.status = SkillStatus.GENERATING;
        accepted.push({ id: skill.id, userId: skill.userId });
      }
      return accepted;
    },
    claimFirstLessonRun: async (skillId: number) => {
      // On-demand ensure claim: lesson-less ACTIVE skills only — the harness
      // has no clock, so the stale-GENERATING branch is unreachable by
      // construction and tests control the preconditions via state setup.
      const skill = state.skills.get(skillId);
      if (!skill || skill.status !== SkillStatus.ACTIVE) return null;
      const hasClass = [...state.classes.values()].some(
        (cls) => cls.skillId === skillId,
      );
      if (hasClass) return null;
      skill.status = SkillStatus.GENERATING;
      return { id: skill.id, userId: skill.userId };
    },
    settleStaleGenerating: async () => {
      // No clock in the harness: every abandoned GENERATING skill (has a
      // class, no live next-class marker) is settled; tests control the
      // preconditions via state setup, mirroring claimStaleInit.
      const settled: number[] = [];
      for (const skill of state.skills.values()) {
        if (skill.status !== SkillStatus.GENERATING) continue;
        const hasClass = [...state.classes.values()].some(
          (cls) => cls.skillId === skill.id,
        );
        if (!hasClass) continue;
        if (nextClassJobRows.has(skill.id)) continue;
        skill.status = SkillStatus.ACTIVE;
        settled.push(skill.id);
      }
      return settled;
    },
    delete: async (id) => {
      state.skills.delete(id);
      nextClassJobRows.delete(id);
      for (const [clsId, cls] of state.classes) {
        if (cls.skillId === id) state.classes.delete(clsId);
      }
      state.vectors = state.vectors.filter((vector) => vector.skillId !== id);
    },
  };

  const classRepo: ClassRepository = {
    findQuestionCountsByClassIds: async (classIds) => {
      const counts = new Map<number, number>();
      for (const question of state.questions.values()) {
        if (question.classId === null || !classIds.includes(question.classId)) {
          continue;
        }
        counts.set(question.classId, (counts.get(question.classId) ?? 0) + 1);
      }
      return [...counts].map(([classId, questionCount]) => ({
        classId,
        questionCount,
      }));
    },
    createWithQuestions: async (cls, questions) => {
      const id = ++classIdSeq;
      state.classes.set(id, {
        id,
        skillId: cls.skillId,
        index: cls.index,
        title: cls.title,
        contentMd: cls.contentMd,
        baseLanguage: cls.baseLanguage,
      });
      for (const question of questions) {
        const questionId = ++questionIdSeq;
        state.questions.set(questionId, {
          id: questionId,
          skillId: cls.skillId,
          classId: id,
          type: question.type,
          text: question.text,
          choices: question.choices,
          answerKey: question.answerKey,
          aiModel: question.aiModel,
        });
      }
      return { id };
    },
    listBySkill: async () => [],
    listBySkillByIndex: async (skillId) =>
      [...state.classes.values()]
        .filter((cls) => cls.skillId === skillId)
        .sort((a, b) => a.index - b.index)
        .map((cls) => ({
          id: cls.id,
          index: cls.index,
          title: cls.title,
          questionCount: [...state.questions.values()].filter(
            (question) => question.classId === cls.id,
          ).length,
        })),
    findTopBySkill: async (skillId) => {
      let top: { id: number; index: number; title: string } | null = null;
      for (const row of state.classes.values()) {
        if (row.skillId !== skillId) continue;
        if (top === null || row.index > top.index) {
          top = { id: row.id, index: row.index, title: row.title };
        }
      }
      return top;
    },
    findById: async (id) => {
      const row = state.classes.get(id);
      return row
        ? {
            id: row.id,
            skillId: row.skillId,
            index: row.index,
            title: row.title,
            contentMd: row.contentMd,
            baseLanguage: row.baseLanguage,
          }
        : null;
    },
    listByIds: async (ids) =>
      [...state.classes.values()]
        .filter((cls) => ids.includes(cls.id))
        .map((cls) => ({ id: cls.id, index: cls.index, title: cls.title })),
  };

  const classIdByQuestion = (questionId: number): number | null =>
    state.questions.get(questionId)?.classId ?? null;

  const quizRepo: QuizRepository = {
    listPendingGradingIds: async (olderThan, limit) =>
      state.answers
        .filter((answer) => {
          if (answer.isCorrect !== null) return false;
          const question = state.questions.get(answer.questionId);
          return question?.type === "OPEN_ENDED";
        })
        .slice(0, limit)
        .map((answer) => answer.id),
    findLatestAttemptResults: async (classId, userId) => {
      // Latest attempt = the last N answers for the class's questions (the
      // client submits all-or-nothing), one row per question, attempt order.
      const questionCount = [...state.questions.values()].filter(
        (question) => question.classId === classId,
      ).length;
      if (questionCount === 0) return [];
      return state.answers
        .filter(
          (answer) =>
            answer.userId === userId &&
            classIdByQuestion(answer.questionId) === classId,
        )
        .slice(-questionCount)
        .flatMap((answer) => {
          const question = state.questions.get(answer.questionId);
          if (!question) return [];
          return [
            {
              questionId: answer.questionId,
              questionType: question.type,
              userAnswer: answer.content.answer,
              isCorrect: answer.isCorrect,
              answerKey: question.answerKey,
            },
          ];
        });
    },
    findWrongAnswersBySkill: async (skillId, userId) => {
      // Recency desc: the harness stores answers in insertion (ascending) order.
      const attempts = [...state.answers]
        .reverse()
        .filter((answer) => answer.userId === userId)
        .map((answer) => ({
          id: answer.id,
          questionId: answer.questionId,
          content: answer.content,
          score: answer.score,
          isCorrect: answer.isCorrect,
          createdAt: new Date(0),
        }));
      const wrong = latestWrongPerQuestion(attempts);
      return wrong.flatMap((answer) => {
        const question = state.questions.get(answer.questionId);
        if (!question || question.skillId !== skillId) {
          return [];
        }
        const classIndex =
          question.classId === null
            ? null
            : (state.classes.get(question.classId)?.index ?? null);
        return [
          {
            answerId: answer.id,
            questionId: answer.questionId,
            questionType: question.type,
            questionText: question.text,
            choices: question.choices,
            answerKey: question.answerKey,
            userAnswer: answer.content.answer,
            feedback: answer.content.feedback ?? null,
            score: answer.score,
            classId: question.classId,
            classIndex,
            answeredAt: answer.createdAt,
          },
        ];
      });
    },
    findReviewCandidatesBySkill: async (skillId, userId) => {
      const byQuestion = new Map<number, ReviewCandidate>();
      for (const answer of state.answers) {
        if (answer.userId !== userId || answer.skillId !== skillId) continue;
        const question = state.questions.get(answer.questionId);
        if (!question) continue;
        let candidate = byQuestion.get(answer.questionId);
        if (!candidate) {
          candidate = {
            questionId: answer.questionId,
            questionText: question.text,
            questionType: question.type,
            classIndex:
              question.classId === null
                ? null
                : (state.classes.get(question.classId)?.index ?? null),
            attempts: [],
          };
          byQuestion.set(answer.questionId, candidate);
        }
        candidate.attempts.push({
          isCorrect: answer.isCorrect,
          createdAt: answer.createdAt,
        });
      }
      return [...byQuestion.values()];
    },
    findAnswerActivityByUser: async (userId) =>
      state.answers
        .filter((answer) => answer.userId === userId)
        .map((answer) => ({
          // The harness has no clock; stats tests fix dates explicitly.
          createdAt: new Date(0),
          skillId: answer.skillId,
          classId: classIdByQuestion(answer.questionId),
          questionId: answer.questionId,
        })),
    findByClassId: async (classId): Promise<QuestionView[]> => {
      const views: QuestionView[] = [];
      for (const question of state.questions.values()) {
        if (question.classId === classId) {
          views.push({
            id: question.id,
            type: question.type,
            text: question.text,
            choices: question.choices,
          });
        }
      }
      return views;
    },
    findScoreableByClassId: async (classId): Promise<ScoreableQuestion[]> => {
      const scoreable: ScoreableQuestion[] = [];
      for (const question of state.questions.values()) {
        if (question.classId === classId) {
          scoreable.push({
            id: question.id,
            skillId: question.skillId,
            type: question.type,
            answerKey: question.answerKey,
          });
        }
      }
      return scoreable;
    },
    createAnswers: async (inputs) => {
      const ids: number[] = [];
      for (const input of inputs) {
        const id = ++answerIdSeq;
        state.answers.push({ ...input, id, createdAt: new Date() });
        ids.push(id);
      }
      return ids;
    },
    findAnswersByClassAndUser: async (
      classId,
      userId,
    ): Promise<AnswerReview[]> =>
      state.answers
        .filter((answer) => {
          const question = state.questions.get(answer.questionId);
          return answer.userId === userId && question?.classId === classId;
        })
        .map((answer) => {
          const question = state.questions.get(answer.questionId);
          return {
            questionId: answer.questionId,
            questionText: question?.text ?? "",
            userAnswer: answer.content.answer,
            correctAnswer: String(question?.answerKey ?? ""),
            isCorrect: answer.isCorrect,
          };
        }),
    findHighestAnsweredClassIndex: async (skillId, userId) => {
      let highest: number | null = null;
      for (const answer of state.answers) {
        if (answer.userId !== userId || answer.skillId !== skillId) continue;
        const classId = classIdByQuestion(answer.questionId);
        if (classId === null) continue;
        const cls = state.classes.get(classId);
        if (cls && (highest === null || cls.index > highest))
          highest = cls.index;
      }
      return highest;
    },
    findAnswerStatsBySkill: async (skillId, userId) => {
      // Distinct-question semantics: retakes must not inflate the totals.
      const answered = new Set<number>();
      const correct = new Set<number>();
      for (const answer of state.answers) {
        if (answer.userId !== userId || answer.skillId !== skillId) continue;
        if (classIdByQuestion(answer.questionId) === null) continue;
        answered.add(answer.questionId);
        if (answer.isCorrect === true) correct.add(answer.questionId);
      }
      const statsByClass = new Map<
        number,
        { answeredCount: number; correctCount: number }
      >();
      for (const questionId of answered) {
        const classId = classIdByQuestion(questionId);
        if (classId === null) continue;
        const stat = statsByClass.get(classId) ?? {
          answeredCount: 0,
          correctCount: 0,
        };
        stat.answeredCount += 1;
        if (correct.has(questionId)) stat.correctCount += 1;
        statsByClass.set(classId, stat);
      }
      return [...statsByClass].map(([classId, stat]) => ({ classId, ...stat }));
    },
    findAnswersWithQuestions: async (answerIds) =>
      state.answers
        .filter((answer) => answerIds.includes(answer.id))
        .map((answer) => {
          const question = state.questions.get(answer.questionId);
          return {
            answerId: answer.id,
            questionId: answer.questionId,
            questionType: question?.type ?? "MULTIPLE_CHOICE",
            questionText: question?.text ?? "",
            answerKey: question?.answerKey,
            userAnswer: answer.content.answer,
            isCorrect: answer.isCorrect,
            classId: classIdByQuestion(answer.questionId),
          };
        }),
    updateGrades: async (rows) => {
      for (const row of rows) {
        const answer = state.answers.find((a) => a.id === row.answerId);
        if (!answer) continue;
        answer.score = row.score;
        answer.isCorrect = row.isCorrect;
        answer.content = {
          answer: answer.content.answer,
          feedback: row.feedback,
        };
      }
    },
  };

  const qaRepo: ClassQaRepository = {
    resetForRetry: async (id) => {
      const block = state.qaBlocks.find((row) => row.id === id);
      if (!block || block.status !== ClassQaStatus.FAILED) return null;
      block.status = ClassQaStatus.PENDING;
      block.answer = null;
      block.aiModel = null;
      return { id: block.id, status: block.status };
    },
    create: async (input: NewClassQaBlock) => {
      const id = ++qaBlockIdSeq;
      state.qaBlocks.push({
        id,
        classId: input.classId,
        userId: input.userId,
        anchorParagraph: input.anchorParagraph,
        anchorText: input.anchorText ?? null,
        question: input.question,
        answer: null,
        status: ClassQaStatus.PENDING,
        aiModel: null,
        createdAt: new Date(0),
      });
      return { id, status: ClassQaStatus.PENDING };
    },
    listByClass: async (classId) =>
      state.qaBlocks
        .filter((block) => block.classId === classId)
        .sort((a, b) => a.anchorParagraph - b.anchorParagraph || a.id - b.id),
    listAnsweredByClass: async (classId, limit) =>
      state.qaBlocks
        .filter(
          (block) =>
            block.classId === classId &&
            block.status === ClassQaStatus.ANSWERED,
        )
        .sort((a, b) => b.id - a.id)
        .slice(0, limit),
    findById: async (id) =>
      state.qaBlocks.find((block) => block.id === id) ?? null,
    answer: async (id, input) => {
      const block = state.qaBlocks.find((row) => row.id === id);
      if (block) {
        block.answer = input.answer;
        block.aiModel = input.aiModel;
        block.status = ClassQaStatus.ANSWERED;
      }
    },
    markFailed: async (id) => {
      const block = state.qaBlocks.find((row) => row.id === id);
      if (block) block.status = ClassQaStatus.FAILED;
    },
    claimStranded: async () => [],
    failExhausted: async () => 0,
  };

  const eventRepo: EventRepository = {
    // usage.report is not exercised in loop scenarios; the read stays inert.
    findUsageEvents: async () => [],
    record: async (event) => {
      state.events.push(event);
    },
  };

  // In-memory VectorStorePort: search filters state.vectors exactly like the
  // Qdrant adapter's payload filters (userId + optional skillId/excludeSkillId).
  const vectorStore: VectorStorePort = {
    upsert: async (vectors) => {
      state.vectors.push(...vectors);
      return ok(vectors.map((_, i) => i + 1));
    },
    searchSimilar: async (input) => {
      const hits: SearchSimilarHit[] = state.vectors
        .filter(
          (vector) =>
            vector.userId === input.userId &&
            (input.skillId === undefined || vector.skillId === input.skillId) &&
            (input.excludeSkillId === undefined ||
              vector.skillId !== input.excludeSkillId),
        )
        .map((vector, i) => ({
          vectorId: i + 1,
          score: 1,
          textSnippet: vector.textSnippet,
          source: vector.source,
          classIndex: vector.classIndex ?? null,
          tokenCount: vector.tokenCount ?? null,
        }));
      return ok(hits.slice(0, input.topK ?? 5));
    },
    deleteBySkill: async (skillId) => {
      state.vectors = state.vectors.filter((vector) => vector.skillId !== skillId);
      return ok(null);
    },
  };

  const recordVectors: LoopHarness["deps"]["recordVectors"] = (vectors) =>
    vectorStore.upsert(vectors);

  const jobs: JobQueuePort = {
    enqueue: (jobName, payload) => {
      state.enqueued.push({ jobName, payload });
    },
  };

  const deps: LoopHarness["deps"] = {
    ai,
    recordAiAttempt: () => {},
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    qaRepo,
    eventRepo,
    recordVectors,
    chatModel: "glm-5.3-flash",
    clock: makeSystemClock(),
    jobs,
  };

  const nextClassJobRows = new Map<
    number,
    {
      skillId: number;
      userId: number;
      status: NextClassJobStatus;
      attempts: number;
      claimedAt: Date | null;
    }
  >();
  const tryClaim = (
    row: {
      status: NextClassJobStatus;
      attempts: number;
      claimedAt: Date | null;
      skillId: number;
      userId: number;
    },
    leaseMinutes: number,
  ): NextClassJobClaim | null => {
    const now = new Date();
    const leaseExpired =
      row.claimedAt !== null &&
      now.getTime() - row.claimedAt.getTime() > leaseMinutes * 60_000;
    if (
      row.status === "PENDING" ||
      (row.status === "PROCESSING" && leaseExpired)
    ) {
      row.status = "PROCESSING";
      row.claimedAt = now;
      row.attempts += 1;
      return {
        skillId: row.skillId,
        userId: row.userId,
        attempts: row.attempts,
        claimedAt: row.claimedAt,
      };
    }
    return null;
  };
  const nextClassJobs: NextClassJobRepository = {
    enqueue: async ({ skillId, userId }) => {
      const existing = nextClassJobRows.get(skillId);
      if (existing) {
        existing.userId = userId;
        existing.status = "PENDING";
        existing.attempts = 0;
        existing.claimedAt = null;
        return;
      }
      nextClassJobRows.set(skillId, {
        skillId,
        userId,
        status: "PENDING",
        attempts: 0,
        claimedAt: null,
      });
    },
    claim: async ({ limit, leaseMinutes }) => {
      const claims: NextClassJobClaim[] = [];
      for (const row of nextClassJobRows.values()) {
        if (claims.length >= limit) break;
        const claim = tryClaim(row, leaseMinutes);
        if (claim) claims.push(claim);
      }
      return claims;
    },
    claimOne: async ({ skillId, leaseMinutes }) => {
      const row = nextClassJobRows.get(skillId);
      return row ? tryClaim(row, leaseMinutes) : null;
    },
    release: async ({ skillId, claimedAt }) => {
      const row = nextClassJobRows.get(skillId);
      if (row && row.claimedAt?.getTime() === claimedAt.getTime()) {
        nextClassJobRows.delete(skillId);
      }
    },
    requeue: async ({ skillId, claimedAt }) => {
      const row = nextClassJobRows.get(skillId);
      if (row && row.claimedAt?.getTime() === claimedAt.getTime()) {
        row.status = "PENDING";
      }
    },
    existsPending: async (skillId) => nextClassJobRows.has(skillId),
  };

  const nextClassWorker = makeNextClassWorker({
    nextClassJobs,
    generateNextClass: makeGenerateNextClass(deps),
  });

  // Answer/QA-memory mining and content vectorization runand content vectorization run the REAL use cases
  //use cases
  // over the in-memory state; the dedup metadata is derived from state.vectors
  // so a second run no-ops.
  const vectorMetadata = {
    findAnswerIdsWithVectors: async (answerIds: number[]) =>
      ok(
        state.vectors
          .filter(
            (vector) =>
              vector.answerId != null && answerIds.includes(vector.answerId),
          )
          .map((vector) => vector.answerId as number),
      ),
    findClassIdsWithVectors: async (classIds: number[], source: VectorSource) =>
      ok(
        state.vectors
          .filter(
            (vector) =>
              vector.classId != null &&
              classIds.includes(vector.classId) &&
              vector.source === source,
          )
          .map((vector) => vector.classId as number),
      ),
    findBlockIdsWithVectors: async (blockIds: number[]) =>
      ok(
        state.vectors
          .filter(
            (vector) =>
              vector.qaBlockId != null && blockIds.includes(vector.qaBlockId),
          )
          .map((vector) => vector.qaBlockId as number),
      ),
    sumTokenCountsByUser: async () => {
      // Embedding spend isn't asserted in loop scenarios; aggregate honestly.
      let totalTokens = 0;
      let nullCount = 0;
      for (const vector of state.vectors) {
        if (vector.tokenCount == null) {
          nullCount += 1;
        } else {
          totalTokens += vector.tokenCount;
        }
      }
      return { totalTokens, nullCount };
    },
  };
  const mineAnswerVectors = makeMineAnswerVectors({
    ai,
    vectorMetadata,
    recordVectors,
    quizRepo,
    classRepo,
  });
  const mineQaVectors = makeMineQaVectors({
    ai,
    vectorMetadata,
    recordVectors,
    qaRepo,
    classRepo,
  });
  const vectorizeClassContent = makeVectorizeClassContent({
    ai,
    vectorMetadata,
    recordVectors,
    classRepo,
    skillRepo,
  });
  const retrieveQaContext = makeRetrieveQaContext({ ai, vectorStore });
  const gradeOpenEnded = makeGradeOpenEnded({ ai, quizRepo, recordAiAttempt: () => {} });
  const answerClassQuestion = makeAnswerClassQuestion({
    ai,
    recordAiAttempt: () => {},
    qaRepo,
    classRepo,
    skillRepo,
    eventRepo,
    chatModel: "glm-5.3-flash",
    retrieveQaContext,
    vectorizeClassContent,
    jobs,
  });

  const handlers = makeJobHandlers({
    generateSkillMetadata: makeGenerateSkillMetadata(deps),
    generateFirstLesson: makeGenerateFirstLesson(deps),
    nextClassWorker,
    answerClassQuestion,
    mineAnswerVectors,
    mineQaVectors,
    vectorizeClassContent,
    gradeOpenEnded,
    generateSkillRecommendations: async () => undefined,
    generateClassClips: async () => undefined,
  });

  const runJob = async (jobName: string) => {
    const index = state.enqueued.findIndex((job) => job.jobName === jobName);
    if (index === -1) {
      throw new Error(`no enqueued job named ${jobName}`);
    }
    const [job] = state.enqueued.splice(index, 1);
    return handlers[jobName]?.(job.payload as never);
  };
  return { state, deps, jobs, nextClassJobs, runJob };
};

export const firstQuestionOfType = (
  harness: LoopHarness,
  classId: number,
  type: QuestionType,
): (NewQuestion & { id: number }) | undefined => {
  for (const question of harness.state.questions.values()) {
    if (question.classId === classId && question.type === type) return question;
  }
  return undefined;
};

export const classesOfSkill = (harness: LoopHarness, skillId: number) =>
  [...harness.state.classes.values()]
    .filter((cls) => cls.skillId === skillId)
    .sort((a, b) => a.index - b.index);
