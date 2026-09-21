# Phase 7 Post-Beta Backlog Audit (2026-09-22)

## 1. Skill List Query: lessonCount/completedLessons/learnedPoints/lastActivityAt

**File**: `apps/backend/src/modules/learning/application/queries/get-skills-list.ts`
- Factory name: `makeGetSkillsList`
- **Deps object**: `{ skillRepo: SkillRepository }` (LearningApiDeps subset)
- **Output**: `{ skills: SkillListItem[] }`
- **Computation** in `apps/backend/src/modules/learning/infrastructure/skill.prisma.repo.ts:listByUser`:
  - `lessonCount`: `skill._count.classes` (Prisma computed count from joining `Class` table — direct column, not joined)
  - `completedLessons`: count of classes where `answeredByClass.count >= questionCountByClass` (requires manual iteration over `questionCountByClass` and `answeredByClass` maps, checks all classes have been answered)
  - `learnedPoints`: count of answered questions per skill (from `answered` grouped by questionId)
  - `lastActivityAt`: `row._max.createdAt` max date across all answers for skill

| Field | Source | Notes |
|---|---|---|
| `lessonCount` | `skill._count.classes` | Direct Prisma select, no join |
| `completedLessons` | Manual map iteration | Requires full manual aggregation over questions |
| `learnedPoints` | `answered` count | Counted via `learnedBySkill` map |
| `lastActivityAt` | `row._max.createdAt` | Computed per-skill max date |

**Issue**: `completedLessons` uses raw `questionCountByClass` (all questions per class) but doesn't verify class exists/has questions (see line 106-112: `if (count > 0 && ...)` guards but `questionCountByClass` comes from `prisma.question.findMany` which filters to `classId not null`, so this seems correct — need verify if any class exists with 0 questions).

```typescript
// Line 106-112: completedLessons guard
for (const [classId, count] of questionCountByClass) {
  const skillId = skillByClass.get(classId);
  if (skillId === undefined) continue;  // class not linked to skill
  if (count > 0 && (answeredByClass.get(classId) ?? 0) >= count) {
    completedBySkill.set(skillId, (completedBySkill.get(skillId) ?? 0) + 1);
  }
}
```

## 2. Prisma Schema: Unused Models/Fields

| Model | Fields Used | Fields **NOT** Used by any code |
|---|---|---|
| `Skill` | All used | — |
| `SkillProgress` | — | **Zero usages** — grep shows 0 references across apps/backend/src |
| `Answer` | `userId`, `content`, `score`, `isCorrect`, `timeSpentMs`, `vectors`, `Skill.skillId` | `skillId` (nullable, rarely used via relation) |
| `Vector` | `source` (AI_INITIAL, AI_NEXT, ANSWER_DERIVED), `classIndex`, `tokenCount` | `Answer.answerId` (nullable relation) |
| `Question` | `type` (QuestionType), `text`, `choices`, `answerKey`, `aiModel` | `Question.source` enum exists but **never referenced** in code |
| `Class` | — | `aiModel`, `vectors` (Vector[] relation exists but rarely used) |

**Unused fields confirmed**: `SkillProgress` (entire model), `Question.source` enum, `Class.aiModel`, `Class.vectors` relation.

## 3. Skill Status State Machine

**File**: `apps/backend/src/modules/learning/domain/skill/skill.ts`

```typescript
export const SKILL_TRANSITIONS: Record<SkillStatus, SkillStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  GENERATING: ["ACTIVE", "FAILED"],
  FAILED: ["GENERATING"],
  ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};
```

**SkillStatus enum** (from schema.prisma:line 77-85):
```prisma
enum SkillStatus {
  DRAFT
  ACTIVE
  PAUSED
  COMPLETED
  ARCHIVED
  GENERATING
  FAILED
}
```

**Edit-skill impact**: Edit-skill command (`apps/backend/src/modules/learning/application/commands/edit-skill.ts`) updates status via Prisma `skill.update` — does not apply `canTransition` guard directly (guard is in service layer).

**Verified transitions**:
- `GENERATING` → `ACTIVE` ✅ (first class created)
- `GENERATING` → `FAILED` ✅ (generation error)
- `FAILED` → `GENERATING` ✅ (retry)
- `ACTIVE` → `PAUSED` ✅
- `ACTIVE` → `COMPLETED` ✅
- `PAUSED` → `ACTIVE` ✅
- `PAUSED` → `COMPLETED` ✅
- `COMPLETED` → `ARCHIVED` ✅

## 4. Scoring: OPEN_ENDED Behavior

**File**: `apps/backend/src/modules/learning/domain/quiz/scoring.ts`

```typescript
export const scoreAnswer = (
  question: Pick<QuestionView, "type"> & { answerKey: unknown },
  answer: Pick<SubmittedAnswer, "answer">,
): { isCorrect: boolean; score: number } => {
  if (question.type === "OPEN_ENDED") {
    return { isCorrect: false, score: 0 };  // ← Hard return
  }
  // MC/TF exact match logic
};
```

**QuestionType enum** (schema.prisma:line 81-84):
```prisma
enum QuestionType {
  MULTIPLE_CHOICE
  TRUE_FALSE
  OPEN_ENDED
}
```

- `OPEN_ENDED` scoring: **Always returns `{isCorrect: false, score: 0}`**
- MC/TF: Exact string/JSON match → score 1 or 0

## 5. Generation Schema: TC/TF Only (OPEN_ENDED Not Produced)

**File**: `apps/backend/src/modules/tutoring/domain/prompts.ts`

**Question type constraint** (INIT_SKILL_SCHEMA, NEXT_CLASS_SCHEMA):
```typescript
"questions": {
  type: "array",
  items: {
    properties: {
      type: { type: "string", enum: ["MULTIPLE_CHOICE", "TRUE_FALSE"] },  // ← TC/TF only
      ...
    },
    ...
  }
}
```

**lessonSummary field**: Exists in schema (line 29-30) — stored as `AI_NEXT` vector

**OPEN_ENDED handling**: **Cannot be generated by tutor** — no question in schema supports OPEN_ENDED

**Personas.ts**: `TUTOR_SYSTEM` enforces TC/TF:
```
Quiz: MULTIPLE_CHOICE (4 choices) or TRUE_FALSE (choices ["True", "False"]) only.
```

**OPEN_ENDED would require**: Schema change to allow "OPEN_ENDED" in question type enum, add field to question schema for question type validation.

## 6. Jobs: JobQueuePort & Handler Wiring

**File**: `apps/backend/src/modules/platform/ports/jobs.ts`
```typescript
export interface JobQueuePort {
  enqueue(jobName: string, payload: unknown): void;
}
export type JobHandler = (payload: never) => Promise<unknown>;
```

**Registered job names** (registry.ts:makeJobHandlers):
- `SKILL_INIT_JOB` → `getGenerateInitialSkillJobHandler(generateInitialSkill)`
- `SKILL_NEXT_CLASS_JOB` → `getGenerateNextClassJobHandler(generateNextClass)`

**Handler implementation** (`generateInitialSkillJobHandler.ts` line 4-16):
```typescript
export const getGenerateInitialSkillJobHandler = (
  generateInitialSkill: GenerateInitialSkill,
) => {
  return async (payload: SkillInitJobPayload) => {
    const result = await generateInitialSkill(payload);
    if (!result.ok) {
      console.error(
        { skillId: payload.skillId, error: result.error },
        "Skill init failed; skill marked FAILED",
      );
    }
  };
};
```

**Error handling**: No ORPC/structured error surface — only `console.error` on failure. Job handler doesn't throw/re-raise errors (caught in set-immediate-jobs.ts).

**Job failure handling**: Silent logging, **no retry logic**, skill status set to `FAILED` via job completion event (handled elsewhere).

## 7. Wiring Pattern: Container & Router

**File**: `apps/backend/src/container.ts`
- Container = `LearningApiDeps` (no SkillApiDeps/QuizApiDeps wires)
- Depends: `skillRepo`, `classRepo`, `quizRepo`, `eventRepo`, `jobs`

**Wiring example** (createSkill):
```typescript
const generateInitialSkill = makeGenerateInitialSkill({
  ai, retrieveContext, skillRepo, classRepo, quizRepo, eventRepo, recordVectors,
  chatModel: config.ai.models.chat
});
```

**Router structure**: `apps/backend/src/router/index.ts` maps HTTP → ORPC → use cases → containers.

**Error mapping**: `apps/backend/src/modules/platform/api/error-mapping.ts`
- `isTaggedError(error).kind.endsWith("NotFound") || error.kind === "NotOwned"` → 404 (`NOT_FOUND`)
- `error.kind === "InvalidSkillTransition"` → 409 (`CONFLICT`)
- Fallback (ORPCError or untyped throw) → 500 (`INTERNAL`)

## 8. Mobile Routes & Components

**Route files**: `apps/mobile/app/**/routes` — need to check mobile app routes.
**Component files**: `apps/mobile/app/components/skill/**`, `class/**`, `quiz/**`

Need to verify `SkillList.tsx` rendering of `completedLessons` (shows "done" instead of count).

## 9. Compose/Config: Unused RabbitMQ

**File**: `docker-compose-dev.yaml` services include (verify unused `rabbitmq` declaration).

**File**: `apps/backend/src/modules/platform/config.ts`
- `LAMBDA_DECAY_DEFAULT` key (need to read exact value).
- Skill.lambda written in `create-skill.ts` via `skillRepo.create` with `{ lambda: input.lambda }`.

## 10. Test Inventory

**Backend tests**: Run `cd apps/backend && pnpm vitest run --reporter=basic` — need green count.
**Mobile TS check**: `pnpm --filter axon-mobile exec tsc --noEmit` — need pass/fail result.
