# Phase 2 — Wire `quiz.submit`: score + persist + mobile submit

> Detailed execution plan for Phase 2 of `BETA_PLAN.md`. Size: small (1 session).
> Touches contract, backend, and mobile — **no DB migration** (Answer model already exists).
> All file paths relative to repo root; line refs verified 2026-09-17.
> Note: dev database name is `axonpath` (first-init name in the `db_data` volume), not `axon`
> as the compose default suggests — confirm with `\l` if psql errors.

## 1. Goal

Submitting a quiz scores answers server-side against the stored `answerKey`, persists `Answer`
rows, records an `ANSWER_SUBMITTED` audit event, and returns a per-question result the mobile app
renders (score + correct/incorrect per question). This unblocks Phase 4, whose `generateNextClass`
trigger hooks into this exact use case.

## 2. Current state (verified)

**Backend/domain:**
- `learning/domain/quiz/scoring.ts:9-24` — pure `scoreAnswer(question, answer)` (MC/TF exact
  match vs `answerKey`, `OPEN_ENDED` → 0). Exists, unit-tested (`scoring.test.ts`), **unused**.
- `learning/domain/quiz/question.ts:30-33` — `SubmittedAnswer { questionId, answer }` type exists;
  `:35` `QuizError = { kind: "ClassNotFound"; classId }` exists, unused.
- `learning/domain/quiz/quiz.repository.ts:3-7` — port has only `createQuestions` +
  `findByClassId` (no `answerKey` — correctly kept out of the client view).
- `learning/infrastructure/quiz.prisma.repo.ts:17` — **`toQuestionView` parses rows with
  `schema.quiz.SubmitQuizAnswersOutput.element`**. This only works because the submit output
  schema is currently (wrongly) `z.array(Question)`. Changing the output schema breaks this
  mapping — must be fixed in the same change.
- `learning/api/quiz.handlers.ts:6-19` — `QuizApiDeps = GetQuizDeps` only; no submit handler.
- `router/index.ts:26-31` — quiz router mounts only `get`.
- `container.ts:26-27` — `eventRepo` is constructed but **not returned** (:47 returns
  `{ skillRepo, classRepo, quizRepo, jobs }`), so handlers can't compose event-writing use cases.
- Identity: `identity/api/auth.middleware.ts:10-17` — `context.user.id` is hard-coded user 1
  (accepted for beta); `error-mapping.ts:14-19` maps any `*NotFound` kind to 404.

**Contract:**
- `packages/api-contract/src/contract/quiz.contract.ts:16-24` — `submit` route fully defined
  (POST `:id/submit`) but **not exported** from `quizContract` (:26-28 exports only `get`).
- `packages/api-contract/src/schema/quiz.schema.ts:19-21` — input `{ answers }` only: **no
  `classId`**, no `timeSpentMs`; `:23` — output is `z.array(Question)`, i.e. echoes questions
  instead of a result.

**Prisma (no migration needed):**
- `Answer` (`src/prisma/schema.prisma:155-174`): `content Json` (required), `score Float?`,
  `isCorrect Boolean?`, `timeSpentMs Int` (**non-null**), `userId Int`, `skillId Int?`.
- `Question` carries `skillId` (:140) → skill attribution comes free from the scored question
  rows; **no `ClassRepository` extension needed**.
- `EventType.ANSWER_SUBMITTED` already exists (:90-96).

**Mobile:**
- `components/quiz/Quiz.tsx:36` — Submit is `console.log('submit')`. Answers live in the Zustand
  store (`store/quiz.store.ts:9` — `answers: { questionId, answer: string | null }[]`); MC writes
  via `useQuizStore` (`MultipleChoiceQuestion.tsx:9-14`).
- **`TrueFalseQuestion.tsx` is a static stub** (renders "True"/"False" text, no store wiring).
  Post-Phase-1 generation is MC/TF-only, so TF must be wired here or most quizzes can't be
  answered.
- `OpenEndedQuestion.tsx` is also a stub — acceptable: Phase 1 stopped generating open-ended;
  old rows simply can't be answered (filtered out of submit; see D5).
- `app/class/[classId]/quiz.tsx:10-13` — quiz fetched via `useQuery`; react-query is already in
  use, so the submit mutation follows the same idiom. The quiz screen is a **tab** inside
  `class/[classId]/_layout.tsx` (Tabs), so `router.back()` deterministically leaves the quiz.
- `utils/rpc.ts:18` — client is typed as `ContractRouterClient<AppContract>`; once the contract
  exports `submit`, `rpc.quiz.submit` typechecks with zero client plumbing.
- `ClassById` (`types/class.ts:4`, from `rpc.class.get`) has **no `skillId`** → interim
  "Continue" cannot deep-link to the skill screen; use `router.back()` (Phase 4 replaces it).

## 3. Design decisions

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| D1 | Input `{ classId, answers: [{ questionId, answer, timeSpentMs? }] }`; output `{ score, total, perQuestion: [{ questionId, isCorrect, correctAnswer }] }` | Per `BETA_PLAN.md` Phase 2 verbatim. `correctAnswer` is `string \| null` — `answerKey` is a nullable JSON column; honest schema beats fabricating "null" strings. UI renders "—" for null |
| D2 | Route path param aligned to `:classId/submit`; `get`'s `:id` left as-is | Plan scopes the rename to submit. Cosmetic anyway: `RPCLink` addresses procedures by name, not path — `path` is OpenAPI metadata only |
| D3 | Extend `QuizRepository` with `findScoreableByClassId` + `createAnswers`; no separate AnswerRepository | Questions + attempts are one aggregate (quiz); one repo per aggregate is the existing granularity (skill/class/quiz/event). Rejected: `classRepo.findById` to resolve skillId — it doesn't return `skillId` (`Pick<Class, "id"\|"title"\|"contentMd">`), and `Question.skillId` already carries it |
| D4 | `findScoreableByClassId` is a **server-only** view (`id, skillId, type, answerKey`) | `answerKey` must never cross the wire; `findByClassId` stays the client view. Two methods encode the boundary in types |
| D5 | Unknown `questionId`s are **skipped**, not rejected; unanswered questions are simply absent; `total` = number of scored answers | Stale client state (skill regenerated mid-quiz) can't poison `Answer` rows — every persisted row references a real question of the class. Rejected: 400 on mismatch (extra error kind for a beta-only concern). `total = scored.length` keeps the result honest w.r.t. what was actually graded |
| D6 | Class with 0 questions → `ClassNotFound` (existing `QuizError` kind → 404 via `toORPCError`) | Nothing to score **and** no reliable skill attribution. Reuses the existing tagged error; zero new error plumbing |
| D7 | `Answer.content` stored as `{ answer: string }`; `timeSpentMs` defaults to `0` when omitted | DB `content` is a required JSON column — one convention, set here, reused by Phase 4's mistakes-mining and post-beta `ANSWER_DERIVED` vectors. DB `timeSpentMs` is non-null; contract field optional |
| D8 | Use case records `ANSWER_SUBMITTED` with `{ classId, score, total }`; event failures never gate the flow | Event type already exists; event repo contract states persistence failures are logged, not surfaced. Phase 4 acceptance greps events, Phase 6's smoke test reuses this |
| D9 | Mobile: `useMutation` → result state in `Quiz.tsx` → separate `QuizResult` component → `router.back()` on Continue | react-query already in use on the same screen; a small presentational component keeps `Quiz.tsx` a controller. Phase 4 swaps Continue for next-lesson navigation |
| D10 | Wire `TrueFalseQuestion` to the store, mirroring MC (single-select toggle) | Post-Phase-1 quizzes are MC/TF; a dead TF component makes the whole phase untestable for half the questions. Answers are the literal choice strings `"True"`/`"False"`, matching the Phase 1 persona's `choices: ["True","False"]` + exact-match `answerKey` |
| D11 | No idempotency (double-submit duplicates Answer rows) | Beta, hard-coded user, append-only attempt history — duplicates are attempts, not corruption. Noted as accepted gap; revisit post-beta |
| D12 | New unit test `submit-quiz.test.ts` (vitest, fake repos) | Matches existing `*.test.ts` colocated conventions; defends the aggregation contract (skip-unknown, ClassNotFound, persistence shape) that Phase 4 builds on |

## 4. Changes, file by file

### 4.1 `packages/api-contract/src/schema/quiz.schema.ts`

Replace `SubmitQuizAnswersInput` (lines 19-21) and `SubmitQuizAnswersOutput` (line 23):

```ts
export const SubmittedAnswer = z.object({
  questionId: z.number(),
  answer: z.string(),
  timeSpentMs: z.number().optional(),
});

export const SubmitQuizAnswersInput = z.object({
  classId: z.number(),
  answers: z.array(SubmittedAnswer),
});

export const QuestionResult = z.object({
  questionId: z.number(),
  isCorrect: z.boolean(),
  /** Null when the stored answerKey is not a plain string (legacy/JSON keys). */
  correctAnswer: z.string().nullable(),
});

export const SubmitQuizAnswersOutput = z.object({
  score: z.number(),
  total: z.number(),
  perQuestion: z.array(QuestionResult),
});
```

`Question` / `GetQuizByClassIdOutput` untouched — `get` semantics unchanged.

### 4.2 `packages/api-contract/src/contract/quiz.contract.ts`

Path (line 19): `path: `${BASE_PATH}/:classId/submit``. Export (lines 26-28):

```ts
export const quizContract = {
  get,
  submit,
}
```

Rebuild the package after this change — backend imports resolve through `dist/`:

```sh
pnpm --filter @axon/api-contract build
```

### 4.3 `apps/backend/src/modules/learning/domain/quiz/question.ts`

Add below `SubmittedAnswer` (line 33) — plus fix the now-stale doc comment above it
("persistence ... out of scope until quiz.submit is wired" is no longer true):

```ts
/**
 * Server-side view of a question for scoring: carries the answerKey and the
 * owning skill. Never mapped to the wire — `findByClassId` remains the
 * client-facing view.
 */
export type ScoreableQuestion = {
  id: number;
  skillId: number;
  type: QuestionType;
  answerKey: unknown;
};

export type NewAnswer = {
  questionId: number;
  userId: number;
  skillId: number;
  /** Storage convention for the Answer.content JSON column. */
  content: { answer: string };
  score: number;
  isCorrect: boolean;
  timeSpentMs: number;
};
```

### 4.4 `apps/backend/src/modules/learning/domain/quiz/quiz.repository.ts`

Extend the port:

```ts
import type { NewAnswer, NewQuestion, QuestionView, ScoreableQuestion } from "./question";

export type QuizRepository = {
  /** Batch-insert questions; returns created ids in input order. */
  createQuestions(inputs: NewQuestion[]): Promise<number[]>;
  findByClassId(classId: number): Promise<QuestionView[]>;
  /** Questions with answer keys + owning skillId, for server-side scoring. */
  findScoreableByClassId(classId: number): Promise<ScoreableQuestion[]>;
  /** Batch-insert scored attempts. */
  createAnswers(inputs: NewAnswer[]): Promise<void>;
};
```

### 4.5 `apps/backend/src/modules/learning/infrastructure/quiz.prisma.repo.ts`

**Fix the latent break first** — `toQuestionView` (line 17) parses with the submit output
schema, which this change reshapes:

```ts
const parsed = schema.quiz.Question.parse(row);
```

Add two members to `makePrismaQuizRepository`:

```ts
  findScoreableByClassId: async (classId) =>
    prisma.question.findMany({
      where: { classId },
      select: { id: true, skillId: true, type: true, answerKey: true },
    }),

  createAnswers: async (inputs) => {
    if (inputs.length === 0) {
      return;
    }
    await prisma.answer.createMany({
      data: inputs.map((input) => ({
        questionId: input.questionId,
        userId: input.userId,
        skillId: input.skillId,
        content: input.content,
        score: input.score,
        isCorrect: input.isCorrect,
        timeSpentMs: input.timeSpentMs,
      })),
    });
  },
```

(`answerKey`/`content` are Prisma JSON columns — `unknown`/object pass through without casts.)

### 4.6 New `apps/backend/src/modules/learning/application/commands/submit-quiz.ts`

```ts
import { err, ok, type Result } from "@/modules/platform/result";
import type { EventRepository } from "@/modules/learning/domain/event/event.repository";
import type { QuizError, SubmittedAnswer } from "@/modules/learning/domain/quiz/question";
import { scoreAnswer } from "@/modules/learning/domain/quiz/scoring";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";

export type SubmitQuizDeps = { quizRepo: QuizRepository; eventRepo: EventRepository };
export type SubmitQuizInput = {
  classId: number;
  userId: number;
  answers: SubmittedAnswer[];
};
export type QuestionResult = {
  questionId: number;
  isCorrect: boolean;
  correctAnswer: string | null;
};
export type SubmitQuizOutput = {
  score: number;
  total: number;
  perQuestion: QuestionResult[];
};

/**
 * Score a quiz attempt and persist it. Question ids the client sends that
 * don't belong to this class are skipped, not rejected — they cannot be
 * scored and must not persist. A class with no questions is ClassNotFound:
 * nothing to score and no skill attribution.
 */
export const makeSubmitQuiz =
  ({ quizRepo, eventRepo }: SubmitQuizDeps) =>
  async (input: SubmitQuizInput): Promise<Result<SubmitQuizOutput, QuizError>> => {
    const questions = await quizRepo.findScoreableByClassId(input.classId);
    if (questions.length === 0) {
      return err({ kind: "ClassNotFound", classId: input.classId });
    }

    const byId = new Map(questions.map((question) => [question.id, question]));
    const scored = input.answers.flatMap((submitted) => {
      const question = byId.get(submitted.questionId);
      if (!question) {
        return [];
      }
      return [{ question, submitted, ...scoreAnswer(question, submitted) }];
    });

    const score = scored.reduce((sum, entry) => sum + entry.score, 0);

    await quizRepo.createAnswers(
      scored.map(({ question, submitted, isCorrect, score }) => ({
        questionId: question.id,
        userId: input.userId,
        skillId: question.skillId,
        content: { answer: submitted.answer },
        score,
        isCorrect,
        timeSpentMs: submitted.timeSpentMs ?? 0,
      })),
    );

    const perQuestion = scored.map(({ question, isCorrect }) => ({
      questionId: question.id,
      isCorrect,
      correctAnswer:
        typeof question.answerKey === "string" ? question.answerKey : null,
    }));

    await eventRepo.record({
      skillId: questions[0].skillId,
      userId: input.userId,
      type: "ANSWER_SUBMITTED",
      payload: { classId: input.classId, score, total: scored.length },
    });

    return ok({ score, total: scored.length, perQuestion });
  };
```

Type note: `scoreAnswer` takes `Pick<QuestionView, "type"> & { answerKey: unknown }` —
`ScoreableQuestion` satisfies it structurally; no cast needed.

### 4.7 `apps/backend/src/modules/learning/api/quiz.handlers.ts`

```ts
import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import { toORPCError } from "@/modules/platform/api/error-mapping";
import { unwrapOrThrow } from "@/modules/platform/result";
import { makeGetQuiz, type GetQuizDeps } from "@/modules/learning/application/queries/get-quiz";
import { makeSubmitQuiz, type SubmitQuizDeps } from "@/modules/learning/application/commands/submit-quiz";

export type QuizApiDeps = GetQuizDeps & SubmitQuizDeps;

export const makeQuizHandlers = (deps: QuizApiDeps) => {
  const getQuiz = makeGetQuiz(deps);
  const submitQuiz = makeSubmitQuiz(deps);

  return {
    get: (async ({ input }) => {
      const questions = await getQuiz(input.classId);
      return questions;
    }) satisfies OrpcHandler<
      z.infer<typeof schema.quiz.GetQuizByClassIdInput>,
      z.infer<typeof schema.quiz.GetQuizByClassIdOutput>
    >,

    submit: (async ({ input, context }) => {
      const result = await submitQuiz({
        classId: input.classId,
        userId: context.user.id,
        answers: input.answers,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.quiz.SubmitQuizAnswersInput>,
      z.infer<typeof schema.quiz.SubmitQuizAnswersOutput>
    >,
  };
};
```

`unwrapOrThrow` + `toORPCError`: the `ClassNotFound` kind ends with "NotFound" → 404
(`error-mapping.ts:16-19`).

### 4.8 `apps/backend/src/router/index.ts`

`buildQuizRouter` (lines 26-31) gains:

```ts
    submit: rpc.quiz.submit.handler(handlers.submit),
```

`LearningApiDeps` widens automatically via `QuizApiDeps`.

### 4.9 `apps/backend/src/container.ts`

Line 47 — return the already-constructed `eventRepo`:

```ts
  return { skillRepo, classRepo, quizRepo, eventRepo, jobs };
```

This is the only container change; `tsc` enforces the rest (`Container = LearningApiDeps`).

### 4.10 New `apps/backend/src/modules/learning/application/commands/submit-quiz.test.ts`

Fake repos (plain closures), following `scoring.test.ts` style. Cases to defend:
1. MC/TF mix → correct `score`/`total`, `perQuestion` flags and `correctAnswer`s.
2. Submitted id not in the class → skipped: no `Answer` row, absent from `perQuestion`/`total`.
3. Unknown class (0 questions) → `err({ kind: "ClassNotFound" })`, nothing persisted.
4. `Answer` rows persisted with `{ answer }` content, score 0/1, `timeSpentMs` default 0 when
   the field is omitted.
5. `ANSWER_SUBMITTED` event recorded with `{ classId, score, total }` and the class's `skillId`.

### 4.11 `apps/mobile/components/quiz/Question/TrueFalseQuestion.tsx`

Replace the static stub (mirrors `MultipleChoiceQuestion.tsx` selection semantics, no Checkbox
needed for a binary choice):

```tsx
import { FC, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuizStore } from '@/store/quiz.store';

export const TrueFalseQuestion: FC<{ questionId: number }> = ({ questionId }) => {
  const { answers, setAnswer } = useQuizStore();
  const answer = answers.find(({ questionId: id }) => id === questionId)?.answer ?? null;

  return (
    <View style={styles.container}>
      {['True', 'False'].map((option) => (
        <Pressable
          key={option}
          style={[styles.option, answer === option && styles.selected]}
          onPress={() => setAnswer(questionId, answer === option ? null : option)}
        >
          <Text>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 12 },
  option: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  selected: { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
});
```

Call site `Question/index.tsx:18` passes the id:

```tsx
{question.type === QuestionType.TRUE_FALSE && (
  <TrueFalseQuestion questionId={question.id} />
)}
```

(Exact styling is placeholder — Phase 5 owns visual polish; the contract that matters is
store round-trip: tap → `setAnswer` → chip highlights.)

### 4.12 `apps/mobile/types/quiz.ts`

Add the derived result type (same idiom as `Question`):

```ts
export type QuizSubmitResult = Awaited<ReturnType<typeof rpc.quiz.submit>>;
```

### 4.13 New `apps/mobile/components/quiz/QuizResult.tsx`

```tsx
import { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@atomics/button';
import type { Question } from '@/types/quiz';
import type { QuizSubmitResult } from '@/types/quiz';

export const QuizResult: FC<{
  result: QuizSubmitResult;
  questions: Question[];
  onContinue: () => void;
}> = ({ result, questions, onContinue }) => {
  const textById = new Map(questions.map((q) => [q.id, q.text]));

  return (
    <View style={styles.container}>
      <Text style={styles.score}>
        You scored {result.score} / {result.total}
      </Text>
      {result.perQuestion.map((entry) => (
        <View key={entry.questionId} style={styles.row}>
          <Text style={entry.isCorrect ? styles.correct : styles.incorrect}>
            {entry.isCorrect ? '✓' : '✗'}
          </Text>
          <View style={styles.body}>
            <Text numberOfLines={2}>{textById.get(entry.questionId) ?? `#${entry.questionId}`}</Text>
            {!entry.isCorrect && entry.correctAnswer !== null && (
              <Text style={styles.answer}>Correct answer: {entry.correctAnswer}</Text>
            )}
          </View>
        </View>
      ))}
      <Button style={styles.continue} onPress={onContinue}>
        <Text style={styles.continueText}>Continue</Text>
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  score: { fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  correct: { color: '#16a34a', fontSize: 18 },
  incorrect: { color: '#dc2626', fontSize: 18 },
  body: { flex: 1, gap: 4 },
  answer: { color: '#6b7280' },
  continue: { width: '50%', alignSelf: 'center', marginTop: 12 },
  continueText: { color: 'white', fontWeight: 'bold' },
});
```

### 4.14 `apps/mobile/components/quiz/Quiz.tsx`

Submit flow replaces the `console.log` (lines 32-39). Shape:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import rpc from '@/utils/rpc';
import type { QuizSubmitResult } from '@/types/quiz';
import { QuizResult } from './QuizResult';

// inside the component:
const router = useRouter();
const [result, setResult] = useState<QuizSubmitResult | null>(null);
const storeAnswers = useQuizStore((state) => state.answers);

const submit = useMutation({
  mutationFn: () => {
    const answers = storeAnswers
      .filter((a): a is { questionId: number; answer: string } => a.answer !== null)
      .map(({ questionId, answer }) => ({ questionId, answer }));
    return rpc.quiz.submit({ classId: props.classId, answers });
  },
  onSuccess: setResult,
});

if (result) {
  return (
    <QuizResult
      result={result}
      questions={classQuestionsList}
      onContinue={() => router.back()}
    />
  );
}
```

And the button:

```tsx
<Button
  style={styles.container}
  disabled={submit.isPending || classQuestionsList.length === 0}
  onPress={() => submit.mutate()}
>
  <Text style={styles.submit}>{submit.isPending ? 'Submitting…' : 'Submit'}</Text>
</Button>
```

Notes:
- `setQuestions` on mount (existing `useLayoutEffect`, line 21) already reinitializes
  `answers`, so returning to the quiz resets state — no manual store reset needed.
- `timeSpentMs` intentionally not sent yet (no per-question timers exist); server defaults 0.
- `onError` is covered by the existing rpc interceptor logging (`utils/rpc.ts:12-14`); the
  button re-enables so the user can retry. Beta-acceptable.

### 4.15 Not touched (explicit non-goals)

Open-ended grading, `generateNextClass` enqueue (Phase 4 hooks the **end of the submit-quiz use
case** — keep that seam in `submit-quiz.ts`, don't enqueue from the handler), `ANSWER_DERIVED`
vectors, idempotency, real auth, `get` route path rename, lesson rendering (Phase 5), status
lifecycle (Phase 4's migration).

## 5. Verification (in order)

```sh
# 1. Contract → backend → types are the migration net; the quiz.prisma.repo fix (4.5)
#    must land in the same commit as the schema change or nothing compiles.
pnpm --filter @axon/api-contract build
pnpm --filter @axon/backend build

# 2. Unit suites (new submit-quiz + existing scoring/skill/result) — must stay green
pnpm --filter @axon/backend test

# 3. Contract dist changed → the running backend must pick it up. packages/api-contract is
#    volume-mounted, but nodemon watches only apps/backend/src — force a reload:
docker restart axon-backend

# 4. Mobile typecheck
pnpm --filter @axon/mobile exec tsc --noEmit
```

Behavioral (backend first, via the dev stack `pnpm backend:dev`):

```sh
# a. Submit a quiz for a real class (classId + two question ids from an existing skill;
#    one answer deliberately wrong). authMiddleware ignores headers — user is always 1.
curl -s -X POST http://localhost:3001/rpc/quiz/submit \
  -H 'content-type: application/json' \
  -d '{"classId": <id>, "answers": [
        {"questionId": <id1>, "answer": "<exact choice text>"},
        {"questionId": <id2>, "answer": "deliberately wrong"}]}'
#   expect: {"score":1,"total":2,"perQuestion":[{"questionId":..,"isCorrect":true,"correctAnswer":..},{"questionId":..,"isCorrect":false,...}]}
#   Also expect 404 for a class with no questions, and a validation error without classId.

# b. Answer rows persisted with score/isCorrect and the { answer } content convention
docker exec axon-db psql -U postgres -d axonpath -c \
  'SELECT a."questionId", a."userId", a."isCorrect", a.score, a."timeSpentMs", a.content \
   FROM "Answer" a ORDER BY a.id DESC LIMIT 5;'
#   expect: one row per submitted answer, userId=1, isCorrect/score reflecting the attempt

# c. Audit event landed
docker exec axon-db psql -U postgres -d axonpath -c \
  'SELECT "skillId", payload FROM "Event" WHERE type = '"'"'ANSWER_SUBMITTED'"'"' \
   ORDER BY id DESC LIMIT 1;'
#   expect: payload {"classId":..,"score":1,"total":2}

# d. answerKey never crossed the wire in the GET view (regression guard for 4.5)
curl -s http://localhost:3001/rpc/quiz/get?classId=<id> | jq '.[0] | keys'
#   expect: ["choices","id","text","type"] — no answerKey
```

Mobile (emulator, `pnpm --filter @axon/mobile dev`): open a class → Quiz tab → select an MC
option and a True/False chip (both highlight) → Submit → result screen shows
"You scored X / Y" with per-question ✓/✗ and the correct answer on misses → Continue returns
to the previous screen. Resubmitting after going back starts a fresh attempt (store reset).

## 6. Risks & failure modes

- **TF answerKey casing** (`"True"` vs `"true"`): scoring is exact-match by design
  (`scoring.ts:22`). Phase 1 personas emit `["True","False"]` choices with exact-text keys, so
  new skills are consistent; **legacy skills generated before Phase 1** may use lowercase keys
  and will score a visible mismatch. Accepted — do not case-fold silently; if it bites, fix the
  data, not the comparator.
- **Contract dist staleness in dev**: backend resolves `@axon/api-contract` through `dist/`;
  forgetting `pnpm --filter @axon/api-contract build` (or the restart in 5.3) yields stale
  schema errors that look like backend bugs. Step order in §5 exists for this.
- **`ZodSmartCoercionPlugin`**: numeric fields (`classId`, `questionId`, `timeSpentMs`) are
  coerced from JSON — a string classId in curl tests silently coerces rather than 400ing.
  Harmless; don't mistake it for schema bypass.
- **Double-submit duplicates Answer rows** (D11): no client disable race protection beyond
  `isPending`; attempts are append-only history, so worst case is an extra row. Accepted for beta.
- **`context.user` nullability**: `authMiddleware` swallows upsert errors and may pass
  `user: undefined` (`as ContextType` cast) — pre-existing; a DB-down submit will surface as a
  500 in the handler, not a crash of this change.

## 7. Rollback

Single revert of the change set. No migration, no data backfill: `Answer` rows written by this
phase are additive and harmless if the code reverts (they'd simply stop being written).
The contract output shape changes — any client that submitted during the window is unaffected
post-revert because the old contract never exposed a working `submit`.
