import { EventType, VectorSource } from "@/prisma/generated";
import { err, ok, type Result } from "@/modules/platform/result";
import type { AiPort } from "@/modules/tutoring/ports";
import {
  buildNextClassPrompt,
  NEXT_CLASS_SCHEMA,
} from "@/modules/tutoring/domain/prompts";
import { TUTOR_SYSTEM } from "@/modules/tutoring/domain/personas";
import {
  extractJsonObject,
  toGeneratedQuestion,
  type GeneratedQuestion,
} from "@/modules/tutoring/domain/parse";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type {
  AnswerReview,
  QuizRepository,
} from "@/modules/learning/domain/quiz/quiz.repository";
import type { NewVector, VectorStoreError } from "@/modules/memory/ports";

/** Enqueued by submit-quiz after a scored attempt — the submit is the learning signal. */
export const SKILL_NEXT_CLASS_JOB = "skill-next-class";

export type SkillNextClassJobPayload = {
  skillId: number;
  userId: number;
};

export type ParsedNextClass = {
  classTitle: string;
  classContentMd: string;
  lessonSummary: string;
  questions: GeneratedQuestion[];
  contextSnippets: string[];
};

export type GenerateNextClassError =
  | { kind: "SkillNotFound"; skillId: number }
  | { kind: "NoClassesYet"; skillId: number }
  | { kind: "AiGenerationFailed"; detail?: string }
  | { kind: "AiResponseInvalid"; detail?: string }
  | { kind: "VectorUpsertFailed"; detail?: string }
  | { kind: "VectorStoreUnavailable"; detail?: string };

/** Retrieval hit narrowed to what the prompt builder needs. */
export type HistoryHit = {
  textSnippet: string;
  source: string;
  classIndex: number | null;
};

export type GenerateNextClassDeps = {
  ai: AiPort;
  /** No excludeSkillId: this skill's own history is wanted here. */
  retrieveContext: (input: {
    userId: number;
    query: string;
    topK?: number;
  }) => Promise<HistoryHit[]>;
  skillRepo: SkillRepository;
  classRepo: ClassRepository;
  quizRepo: QuizRepository;
  eventRepo: EventRepository;
  recordVectors: (vectors: NewVector[]) => Promise<Result<number[], VectorStoreError>>;
  chatModel: string;
};

export type GenerateNextClassInput = {
  skillId: number;
  userId: number;
};

/** The bound, dependency-complete use case — what the job registry consumes. */
export type GenerateNextClass = (
  input: GenerateNextClassInput,
) => Promise<Result<void, GenerateNextClassError>>;

/**
 * The adaptive loop's engine: generate the next, personalized class for a
 * skill. Runs in the background ("skill-next-class" job, enqueued by
 * submit-quiz after a scored attempt):
 *   1. Resolve the skill and its latest class (NoClassesYet means init has
 *      not finished — permanent, the job must not have run).
 *   2. Read the user's quiz attempts for that class; the latest attempt per
 *      question wins, so retakes do not flood the prompt.
 *   3. Retrieve per-user lesson memory in one call (split by source in the
 *      prompt: AI_NEXT = lessons already covered, AI_INITIAL = learner facts).
 *   4. Generate and audit CLASS_GENERATED.
 *   5. Persist class (index + 1), questions, and vectors (lessonSummary as
 *      AI_NEXT, snippets as AI_INITIAL) so memory keeps compounding.
 *
 * Retrieval failure degrades to no history; generation/parse failure aborts
 * with nothing persisted. The skill stays ACTIVE — clients observe progress
 * via class.list.
 */
export const makeGenerateNextClass =
  ({
    ai,
    retrieveContext,
    skillRepo,
    classRepo,
    quizRepo,
    eventRepo,
    recordVectors,
    chatModel,
  }: GenerateNextClassDeps) =>
  async (
    input: GenerateNextClassInput,
  ): Promise<Result<void, GenerateNextClassError>> => {
    const skill = await skillRepo.findById(input.skillId);
    if (!skill) {
      return err({ kind: "SkillNotFound", skillId: input.skillId });
    }

    const last = await classRepo.findTopBySkill(input.skillId);
    if (!last) {
      return err({ kind: "NoClassesYet", skillId: input.skillId });
    }

    // Latest attempt per question wins: answers arrive id-asc, so a Map keyed
    // by questionId keeps the newest row per question.
    const latestByQuestion = new Map<number, AnswerReview>();
    for (const review of await quizRepo.findAnswersByClassAndUser(
      last.id,
      input.userId,
    )) {
      latestByQuestion.set(review.questionId, review);
    }
    const attempts = [...latestByQuestion.values()];
    const mistakes = attempts
      .filter((attempt) => attempt.isCorrect === false)
      .map(({ questionText, userAnswer, correctAnswer }) => ({
        questionText,
        userAnswer,
        correctAnswer,
      }));
    const allCorrect = attempts.length > 0 && mistakes.length === 0;

    // One retrieval call for both history blocks; degrades to [] on failure.
    const history = await retrieveContext({
      userId: input.userId,
      query: `${skill.topic} ${last.title}`,
      topK: 12,
    });
    const lastSummaryHit = history.find(
      (hit) =>
        hit.source === VectorSource.AI_NEXT && hit.classIndex === last.index,
    );
    const priorHistory = lastSummaryHit
      ? history.filter((hit) => hit !== lastSummaryHit)
      : history;

    const prompt = buildNextClassPrompt({
      topic: skill.topic,
      lastTitle: last.title,
      lastSummary: lastSummaryHit?.textSnippet,
      history: priorHistory,
      mistakes,
      allCorrect,
    });

    const generation = await ai.generateJson(
      { system: TUTOR_SYSTEM, prompt },
      { schemaName: "next_class", responseSchema: NEXT_CLASS_SCHEMA },
    );
    if (!generation.ok) {
      return { ok: false, error: generation.error };
    }

    let parsed: ParsedNextClass;
    try {
      // Named cast: untrusted model output; every field re-validated below.
      const raw = extractJsonObject(generation.value.raw) as Partial<ParsedNextClass>;
      parsed = {
        classTitle: raw.classTitle ?? "Unknown title",
        classContentMd: raw.classContentMd ?? "",
        lessonSummary: raw.lessonSummary ?? "",
        questions: (Array.isArray(raw.questions) ? raw.questions : [])
          .map(toGeneratedQuestion)
          .filter((q): q is GeneratedQuestion => q !== null),
        contextSnippets: raw.contextSnippets ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: "AiResponseInvalid",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }

    // Audit CLASS_GENERATED with the full request + response for debugging.
    await eventRepo.record({
      skillId: input.skillId,
      userId: input.userId,
      type: EventType.CLASS_GENERATED,
      payload: {
        action: "next_class",
        prompt,
        system: TUTOR_SYSTEM,
        model: chatModel,
        response: generation.value.raw,
      },
    });

    const classIndex = last.index + 1;
    const createdClass = await classRepo.create({
      skillId: input.skillId,
      index: classIndex,
      title: parsed.classTitle,
      contentMd: parsed.classContentMd,
      aiModel: chatModel,
    });

    await quizRepo.createQuestions(
      parsed.questions.map((question) => ({
        skillId: input.skillId,
        classId: createdClass.id,
        type: question.type,
        text: question.text,
        choices: question.choices,
        answerKey: question.answerKey,
        aiModel: chatModel,
      })),
    );

    // Memory compounding: the lesson summary is the AI_NEXT memory unit, the
    // learner-facing snippets continue the AI_INITIAL series. One embedding
    // call for both.
    const vectorInputs: { text: string; source: VectorSource }[] = [];
    if (parsed.lessonSummary.trim().length > 0) {
      vectorInputs.push({
        text: parsed.lessonSummary,
        source: VectorSource.AI_NEXT,
      });
    }
    for (const snippet of parsed.contextSnippets) {
      vectorInputs.push({ text: snippet, source: VectorSource.AI_INITIAL });
    }

    if (vectorInputs.length > 0) {
      const embeddings = await ai.generateEmbeddings(
        vectorInputs.map((vector) => vector.text),
      );
      if (!embeddings.ok) {
        return { ok: false, error: embeddings.error };
      }
      const recorded = await recordVectors(
        embeddings.value.map((embedding, i) => ({
          skillId: input.skillId,
          userId: input.userId,
          classId: createdClass.id,
          embedding,
          source: vectorInputs[i].source,
          textSnippet: vectorInputs[i].text,
          classIndex,
        })),
      );
      if (!recorded.ok) {
        return { ok: false, error: recorded.error };
      }
    }

    return ok(undefined);
  };
