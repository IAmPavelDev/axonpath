import { ok, type Result } from "@/modules/platform/result";
import { VectorSource } from "@/prisma/generated";
import type { AiPort } from "@/modules/tutoring/ports";
import { embeddingTokenCounts } from "@/modules/tutoring/domain/embedding-tokens";
import type {
  NewVector,
  VectorMetadataRepository,
  VectorStoreError,
} from "@/modules/memory/ports";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";

export const SKILL_ANSWER_VECTORS_JOB = "skill-answer-vectors";

export type SkillAnswerVectorsJobPayload = {
  skillId: number;
  userId: number;
  /** Wrong MC/TF answer ids from one submit, already capped by the enqueue site. */
  answerIds: number[];
};

/** Hard ceiling per submit so a disaster quiz cannot flood the embedder. */
export const ANSWER_VECTORS_CAP = 10;

export type MineAnswerVectorsDeps = {
  /** Embeddings only — the miner never generates lessons. */
  ai: Pick<AiPort, "generateEmbeddings">;
  vectorMetadata: VectorMetadataRepository;
  recordVectors: (
    vectors: NewVector[],
  ) => Promise<Result<number[], VectorStoreError>>;
  quizRepo: QuizRepository;
  classRepo: ClassRepository;
};

export type MineAnswerVectors = (
  input: SkillAnswerVectorsJobPayload,
) => Promise<Result<void, never>>;

const answerKeyText = (answerKey: unknown): string =>
  typeof answerKey === "string" ? answerKey : String(answerKey ?? "");

/**
 * Mine wrong answers into ANSWER_DERIVED memory (Phase 7 D3). Per answer,
 * ONE atomic third-person learner fact in the AI_INITIAL voice:
 * `Struggled with: <question text>. Answered "<user answer>"; correct:
 * "<answerKey>" (<class title>).`
 *
 * Order of operations: dedup first (an answer is mined at most once ever —
 * retakes re-enqueue, the answerId-keyed metadata makes the second pass a
 * no-op), then only wrong, class-attached answers become snippets. Every
 * failure — metadata read, embedding, record — degrades to ok with nothing
 * recorded, mirroring the retrieval policy: memory is never load-bearing.
 */
export const makeMineAnswerVectors =
  ({ ai, vectorMetadata, recordVectors, quizRepo, classRepo }: MineAnswerVectorsDeps) =>
  async (input: SkillAnswerVectorsJobPayload): Promise<Result<void, never>> => {
    try {
      if (input.answerIds.length === 0) {
        return ok(undefined);
      }

      const mined = await vectorMetadata.findAnswerIdsWithVectors(input.answerIds);
      if (!mined.ok) {
        return ok(undefined);
      }
      const minedSet = new Set(mined.value);
      const pending = input.answerIds.filter((id) => !minedSet.has(id));
      if (pending.length === 0) {
        return ok(undefined);
      }

      const answers = await quizRepo.findAnswersWithQuestions(pending);
      // Re-check wrongness and class attachment so a misplaced enqueue can
      // never mint a false gap (class-less answers belong to no lesson).
      const minable = answers.filter(
        (answer) => answer.isCorrect === false && answer.classId !== null,
      );
      if (minable.length === 0) {
        return ok(undefined);
      }

      const classes = await classRepo.listByIds([
        ...new Set(minable.map((answer) => answer.classId as number)),
      ]);
      const classById = new Map(classes.map((cls) => [cls.id, cls]));

      const snippets = minable.map((answer) => {
        const cls = classById.get(answer.classId as number);
        return {
          answerId: answer.answerId,
          classId: answer.classId as number,
          classIndex: cls?.index ?? null,
          // One trailing period belongs to the template, not the question —
          // generated texts often end in "." themselves. Attribution is
          // embedded (Phase 8 D6-R5): the typed answer is the learner's, the
          // correct answer is the lesson's.
          textSnippet: `Struggled with: ${answer.questionText.replace(/\.$/, "")}. The learner answered "${answer.userAnswer}"; the lesson's correct answer was "${answerKeyText(answer.answerKey)}" (${cls?.title ?? "lesson"}).`,
        };
      });

      const embeddings = await ai.generateEmbeddings(
        snippets.map((snippet) => snippet.textSnippet),
      );
      if (!embeddings.ok || embeddings.value.embeddings.length !== snippets.length) {
        return ok(undefined);
      }

      const tokenCounts = embeddingTokenCounts(
        embeddings.value.usage,
        embeddings.value.embeddings.length,
      );
      const vectors = snippets.map((snippet, i) => ({
        skillId: input.skillId,
        userId: input.userId,
        classId: snippet.classId,
        classIndex: snippet.classIndex,
        source: VectorSource.ANSWER_DERIVED,
        textSnippet: snippet.textSnippet,
        embedding: embeddings.value.embeddings[i],
        tokenCount: tokenCounts[i],
        answerId: snippet.answerId,
      })) satisfies NewVector[];

      // Record failure is a degrade too — the vectors are best-effort memory.
      await recordVectors(vectors);
      return ok(undefined);
    } catch {
      // Background best-effort memory: an unexpected failure degrades to
      // "no memory", never a thrown error.
      return ok(undefined);
    }
  };
