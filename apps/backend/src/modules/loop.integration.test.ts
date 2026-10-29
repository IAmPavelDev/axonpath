import { describe, expect, it } from "vitest";
import {
  EventType,
  SkillStatus,
  VectorSource,
} from "@/prisma/generated";
import { ok, unwrapOrThrow } from "@/modules/platform/result";
import {
  SKILL_INIT_JOB,
  makeCreateSkill,
} from "@/modules/learning/application/commands/create-skill";
import { makeEditSkill } from "@/modules/learning/application/commands/edit-skill";
import { SKILL_FIRST_LESSON_JOB } from "@/modules/tutoring/application/generate-first-lesson";
import { makeAskClassQuestion } from "@/modules/learning/application/commands/ask-class-question";
import { makeSubmitQuiz } from "@/modules/learning/application/commands/submit-quiz";
import { makeRetrySkill } from "@/modules/learning/application/commands/retry-skill";
import {
  CLASS_QA_ANSWER_JOB,
} from "@/modules/tutoring/application/answer-class-question";
import {
  SKILL_NEXT_CLASS_JOB,
} from "@/modules/tutoring/application/generate-next-class";
import {
  QA_BLOCK_VECTORS_JOB,
} from "@/modules/memory/application/mine-qa-vectors";
import { SKILL_ANSWER_VECTORS_JOB } from "@/modules/memory/application/mine-answer-vectors";
import { GRADE_OPEN_ENDED_JOB } from "@/modules/tutoring/application/grade-open-ended";
import {
  classesOfSkill,
  firstQuestionOfType,
  makeLoopHarness,
  type LoopHarness,
} from "@/modules/testing/fakes";

const acceptDraft = (h: LoopHarness, skillId: number) =>
  makeEditSkill({
    skillRepo: h.deps.skillRepo,
    classRepo: h.deps.classRepo,
    jobs: h.jobs,
    awaitDrain: async () => {},
  })({
    id: skillId,
    userId: 7,
    topic: "SQL Joins",
    description: "Learn SQL joins by doing.",
  });

const PROMPT = "I want to learn SQL joins for work — I know basic SELECTs.";

/**
 * The composed adaptive loop: the REAL use cases (create, metadata init,
 * edit-accept, first lesson, submit, next-class, retry) and the REAL job
 * registry wired over in-memory fakes. This is the CI-able version of the
 * manual smoke test — beta acceptance §3.
 */
describe("adaptive loop integration", () => {
  it("runs create → metadata → accept → first lesson → submit → next-class, then dedups a consecutive retake", async () => {
    const h = makeLoopHarness({
      gradingRaw: JSON.stringify({
        results: [
          {
            answerId: 2,
            score: 0.9,
            correct: true,
            feedback: "Right idea; name the join predicate explicitly.",
          },
        ],
      }),
    });
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });

    // 1. Create → GENERATING; init job (stage 1) → ACTIVE with the drafted
    //    title + description and ZERO classes — the lesson waits for
    //    acceptance.
    const created = await createSkill({ userId: 7, prompt: PROMPT });
    expect(created).toEqual(ok({ id: 1, status: SkillStatus.GENERATING }));
    const skillId = unwrapOrThrow(created).id;

    await h.runJob(SKILL_INIT_JOB);

    expect(h.state.skills.get(skillId)).toMatchObject({
      status: SkillStatus.ACTIVE,
      topic: "SQL Joins",
      description: "Learn SQL joins by doing.",
    });
    expect(classesOfSkill(h, skillId)).toHaveLength(0);
    // The metadata call is audited as SKILL_CREATED (usage bucket skillInit).
    const createdEvents = h.state.events.filter(
      (event) => event.type === EventType.SKILL_CREATED,
    );
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]).toMatchObject({ skillId, userId: 7 });
    expect(createdEvents[0]?.payload).toMatchObject({
      action: "skill_metadata",
      model: "glm-5.3-flash",
    });

    // 1b. Acceptance: the learner saves the draft — GENERATING again and the
    //     first-lesson job armed; the lesson pipeline composes class 0 with
    //     questions, AI_NEXT summary vector and AI_INITIAL snippet vectors.
    const accepted = await acceptDraft(h, skillId);
    expect(accepted).toEqual(
      ok({
        id: skillId,
        topic: "SQL Joins",
        description: "Learn SQL joins by doing.",
        status: SkillStatus.GENERATING,
      }),
    );

    await h.runJob(SKILL_FIRST_LESSON_JOB);

    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);
    const class0 = classesOfSkill(h, skillId);
    expect(class0).toHaveLength(1);
    expect(class0[0]).toMatchObject({ index: 0, title: "SQL joins from zero" });

    const questions = [...h.state.questions.values()].filter(
      (question) => question.classId === class0[0]?.id,
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ text: "An INNER JOIN drops unmatched rows." });

    expect(h.state.vectors).toHaveLength(2);
    expect(h.state.vectors[0]).toMatchObject({
      source: VectorSource.AI_NEXT,
      classIndex: 0,
      skillId,
      userId: 7,
    });
    expect(h.state.vectors[1]).toMatchObject({ source: VectorSource.AI_INITIAL, classIndex: 0 });

    // The lesson brief carries the learner's original prompt, not just the
    // generated title.
    const lessonCall = h.state.aiCalls.find(
      (call) => call.schemaName === "init_skill",
    );
    expect(lessonCall?.prompt).toContain(PROMPT);
    expect(lessonCall?.prompt).toContain("Learn SQL joins by doing.");

    // The class gains one open-ended question (generation unlocks it in S5;
    // grading must already handle it end-to-end).
    h.state.questions.set(9001, {
      id: 9001,
      skillId,
      classId: class0[0]?.id ?? 0,
      type: "OPEN_ENDED",
      text: "Explain why an INNER JOIN drops unmatched rows.",
      choices: [],
      answerKey: "Rows without a match in the other table fail the join predicate.",
    });

    // 2. Submit with one deliberate wrong answer → scored, next-class enqueued.
    const submitQuiz = makeSubmitQuiz({
      quizRepo: h.deps.quizRepo,
      eventRepo: h.deps.eventRepo,
      skillRepo: h.deps.skillRepo,
      jobs: h.jobs,
      nextClassJobs: h.nextClassJobs,
    });
    const trueFalse = firstQuestionOfType(h, class0[0]?.id ?? 0, "TRUE_FALSE");
    expect(trueFalse).toBeDefined();

    const submitted = await submitQuiz({
      classId: class0[0]?.id ?? 0,
      userId: 7,
      answers: [
        { questionId: trueFalse?.id ?? 0, answer: "False" },
        { questionId: 9001, answer: "Rows without matches are dropped." },
      ],
    });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.value).toMatchObject({
        score: 0,
        total: 2,
        perQuestion: [
          { type: "TRUE_FALSE", isCorrect: false, correctAnswer: "True" },
          { type: "OPEN_ENDED", isCorrect: null, correctAnswer: null },
        ],
      });
    }
    expect(h.state.enqueued.at(-1)).toEqual({
      jobName: SKILL_NEXT_CLASS_JOB,
      payload: { skillId, userId: 7 },
    });
    // The submit flipped the skill into its generating phase.
    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.GENERATING);

    // 2b. Answer-memory mining (Phase 7 D3): the wrong submit answer becomes
    // ONE ANSWER_DERIVED vector keyed by its answerId, then a replay of the
    // same job records nothing (dedup is keyed on the metadata rows).
    expect(h.state.vectors).toHaveLength(2);
    await h.runJob(SKILL_ANSWER_VECTORS_JOB);
    expect(h.state.vectors).toHaveLength(3);
    expect(h.state.vectors[2]).toMatchObject({
      source: VectorSource.ANSWER_DERIVED,
      classIndex: 0,
      skillId,
      userId: 7,
      answerId: 1,
      textSnippet:
        'Struggled with: An INNER JOIN drops unmatched rows. The learner answered "False"; the lesson\'s correct answer was "True" (SQL joins from zero).',
    });
    // A retake re-enqueues the same answer ids (replay) — records nothing.
    h.state.enqueued.push({
      jobName: SKILL_ANSWER_VECTORS_JOB,
      payload: { skillId, userId: 7, answerIds: [1] },
    });
    await h.runJob(SKILL_ANSWER_VECTORS_JOB);
    expect(h.state.vectors).toHaveLength(3);

    // 2c. Open-ended grading (Phase 7 D4): the pending open-ended answer
    // gets its AI grade and the feedback lands in the content JSON.
    expect(h.state.answers).toHaveLength(2);
    await h.runJob(GRADE_OPEN_ENDED_JOB);
    expect(h.state.answers[0]).toMatchObject({
      id: 1,
      score: 0,
      isCorrect: false,
    });
    expect(h.state.answers[1]).toMatchObject({
      id: 2,
      score: 0.9,
      isCorrect: true,
      content: {
        answer: "Rows without matches are dropped.",
        feedback: "Right idea; name the join predicate explicitly.",
      },
    });

    // 3. Run the next-class handler → class 1 personalized on the miss.
    await h.runJob(SKILL_NEXT_CLASS_JOB);

    const class1 = classesOfSkill(h, skillId);
    expect(class1).toHaveLength(2);
    expect(class1[1]).toMatchObject({ index: 1, title: "Joins deep dive" });

    const nextCall = h.state.aiCalls.find((call) => call.schemaName === "next_class");
    expect(nextCall).toBeDefined();
    expect(nextCall?.prompt).toContain("An INNER JOIN drops unmatched rows.");
    expect(nextCall?.prompt).toContain("True");
    // AI_NEXT lesson summary from class 0 surfaces as the lifted history block.
    expect(nextCall?.prompt).toContain("This lesson introduced inner and left joins");
    // The mined gap surfaces in the dedicated ANSWER_DERIVED prompt block.
    expect(nextCall?.prompt).toContain(
      "Known gaps — from the learner's wrong quiz answers (notes written by Axon). The learner has missed these before; weave in a re-test",
    );
    expect(nextCall?.prompt).toContain(
      'Struggled with: An INNER JOIN drops unmatched rows. The learner answered "False"; the lesson\'s correct answer was "True"',
    );
    // Two audits so far: the accepted first lesson and the adaptive
    // next-class lesson.
    const generated = h.state.events.filter(
      (event) => event.type === EventType.CLASS_GENERATED,
    );
    expect(generated).toHaveLength(2);
    expect(generated[0]).toMatchObject({ skillId, userId: 7 });
    expect(generated[0]?.payload).toMatchObject({ action: "first_lesson" });
    expect(generated[1]?.payload).toMatchObject({ action: "next_class" });
    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);

    // 4. Retake the same quiz → the next-class handler no-ops (D3 dedup):
    //    no class 2, no event, no AI call.
    await submitQuiz({
      classId: class0[0]?.id ?? 0,
      userId: 7,
      answers: [{ questionId: trueFalse?.id ?? 0, answer: "False" }],
    });
    await h.runJob(SKILL_NEXT_CLASS_JOB);
    // Settled back once the personalized class landed.
    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);

    expect(classesOfSkill(h, skillId)).toHaveLength(2);
    expect(
      h.state.aiCalls.filter((call) => call.schemaName === "next_class"),
    ).toHaveLength(1);
    expect(
      h.state.events.filter((event) => event.type === EventType.CLASS_GENERATED),
    ).toHaveLength(2);
    // Retake flipped GENERATING again; the dedup no-op settled it back.
    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);
  });

  it("heals a failed metadata draft through retry (stage 1 replays from the stored prompt)", async () => {
    // Scripted AI failure in stage 1 → FAILED + ERROR_OCCURRED, no draft.
    const h = makeLoopHarness({ failOnceOn: "skill_metadata" });
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    const created = await createSkill({ userId: 7, prompt: PROMPT });
    const skillId = unwrapOrThrow(created).id;

    await h.runJob(SKILL_INIT_JOB);

    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.FAILED);
    expect(h.state.events).toHaveLength(1);
    expect(h.state.events[0]).toMatchObject({ type: EventType.ERROR_OCCURRED, skillId });
    expect(classesOfSkill(h, skillId)).toHaveLength(0);

    // skill.retry → GENERATING + a fresh skill-init job with the stored prompt.
    const retrySkill = makeRetrySkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs, awaitDrain: async () => {} });
    const retried = await retrySkill({ skillId, userId: 7 });
    expect(retried).toEqual(ok({ status: SkillStatus.GENERATING }));
    expect(h.state.enqueued.at(-1)?.jobName).toBe(SKILL_INIT_JOB);

    await h.runJob(SKILL_INIT_JOB);

    // Stage 1 only: the draft lands, no lesson yet — acceptance still gates it.
    expect(h.state.skills.get(skillId)).toMatchObject({
      status: SkillStatus.ACTIVE,
      topic: "SQL Joins",
    });
    expect(classesOfSkill(h, skillId)).toHaveLength(0);
    expect(
      h.state.aiCalls.filter((call) => call.schemaName === "skill_metadata"),
    ).toHaveLength(2);

    await acceptDraft(h, skillId);
    await h.runJob(SKILL_FIRST_LESSON_JOB);

    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);
    expect(classesOfSkill(h, skillId)).toHaveLength(1);
  });

  it("heals a partial first-lesson persist through retry without regenerating", async () => {
    // Embeddings fail AFTER the class was persisted (stage 2): FAILED with
    // class 0 present. The retry routes to stage 2 (a draft exists), whose
    // guard skips generation and heals to ACTIVE — no duplicate class, no
    // new lesson AI calls (D2).
    const h = makeLoopHarness({ failEmbeddingsOnce: true });
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    const created = await createSkill({ userId: 7, prompt: PROMPT });
    const skillId = unwrapOrThrow(created).id;

    await h.runJob(SKILL_INIT_JOB);
    await acceptDraft(h, skillId);
    await h.runJob(SKILL_FIRST_LESSON_JOB);

    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.FAILED);
    expect(classesOfSkill(h, skillId)).toHaveLength(1);

    const retrySkill = makeRetrySkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs, awaitDrain: async () => {} });
    const retried = await retrySkill({ skillId, userId: 7 });
    expect(retried).toEqual(ok({ status: SkillStatus.GENERATING }));
    expect(h.state.enqueued.at(-1)?.jobName).toBe(SKILL_FIRST_LESSON_JOB);
    await h.runJob(SKILL_FIRST_LESSON_JOB);

    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);
    expect(classesOfSkill(h, skillId)).toHaveLength(1);
    expect(
      h.state.aiCalls.filter((call) => call.schemaName === "init_skill"),
    ).toHaveLength(1);
    // First run: SKILL_CREATED (metadata) + CLASS_GENERATED (lesson audit)
    // + ERROR_OCCURRED. The healed run adds nothing — the guard
    // short-circuits before any event is recorded.
    expect(
      h.state.events.filter((event) => event.type === EventType.ERROR_OCCURRED),
    ).toHaveLength(1);
    expect(
      h.state.events.filter((event) => event.type === EventType.CLASS_GENERATED),
    ).toHaveLength(1);
  });

  it("refuses a retry the user does not own or from a non-FAILED state", async () => {
    const h = makeLoopHarness();
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    const created = await createSkill({ userId: 7, prompt: PROMPT });
    const skillId = unwrapOrThrow(created).id;
    await h.runJob(SKILL_INIT_JOB); // → ACTIVE (draft ready, no lesson yet)

    const retrySkill = makeRetrySkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs, awaitDrain: async () => {} });

    const notOwner = await retrySkill({ skillId, userId: 99 });
    expect(notOwner).toEqual({ ok: false, error: { kind: "NotOwned", skillId } });

    const notFailed = await retrySkill({ skillId, userId: 7 });
    expect(notFailed).toEqual({
      ok: false,
      error: { kind: "InvalidSkillTransition", from: SkillStatus.ACTIVE, to: SkillStatus.GENERATING },
    });
  });

  it("answers an anchored QA question through the layered pipeline and memory", async () => {
    const h = makeLoopHarness();
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    const created = await createSkill({ userId: 7, prompt: PROMPT });
    const skillId = unwrapOrThrow(created).id;
    await h.runJob(SKILL_INIT_JOB);
    await acceptDraft(h, skillId);
    await h.runJob(SKILL_FIRST_LESSON_JOB);
    const class0 = classesOfSkill(h, skillId)[0];

    // 1. Ask with a verbatim selection → PENDING block + answer job.
    const ask = makeAskClassQuestion({
      classRepo: h.deps.classRepo,
      skillRepo: h.deps.skillRepo,
      qaRepo: h.deps.qaRepo,
      jobs: h.jobs,
    });
    const asked = await ask({
      classId: class0?.id ?? 0,
      userId: 7,
      anchorParagraph: 0,
      anchorText: "Meet the join.",
      question: "What is a join?",
    });
    expect(asked).toEqual(ok({ blockId: 1, status: "PENDING" }));

    // 2. The answer job assembles the layered prompt and settles ANSWERED.
    await h.runJob(CLASS_QA_ANSWER_JOB);
    const block = h.state.qaBlocks[0];
    expect(block).toMatchObject({ status: "ANSWERED", anchorText: "Meet the join." });

    const qaCall = h.state.aiCalls.find((call) => call.schemaName === "class_qa_answer");
    expect(qaCall).toBeDefined();
    expect(qaCall?.prompt).toContain("Document model:");
    expect(qaCall?.prompt).toContain('"""Meet the join."""');
    expect(qaCall?.prompt).toContain('The learner typed:\n"""What is a join?"""');
    expect(qaCall?.prompt).toContain("## Introduction");

    // Lazy CONTENT_CHUNK backfill: the pre-generation class is embedded once.
    const contentChunks = h.state.vectors.filter(
      (vector) => vector.source === VectorSource.CONTENT_CHUNK,
    );
    expect(contentChunks.length).toBeGreaterThanOrEqual(1);
    expect(contentChunks[0]).toMatchObject({ classId: class0?.id, classIndex: 0 });

    // 3. The answered block is mined into QA_DERIVED memory exactly once.
    expect(h.state.enqueued.at(-1)).toEqual({
      jobName: QA_BLOCK_VECTORS_JOB,
      payload: { blockId: 1 },
    });
    await h.runJob(QA_BLOCK_VECTORS_JOB);
    const qaVectors = h.state.vectors.filter(
      (vector) => vector.source === VectorSource.QA_DERIVED,
    );
    expect(qaVectors).toHaveLength(1);
    expect(qaVectors[0]).toMatchObject({ qaBlockId: 1, classId: class0?.id });
    // A replay of the answer job no-ops (block settled) — no second mining.
    h.state.enqueued.push({ jobName: QA_BLOCK_VECTORS_JOB, payload: { blockId: 1 } });
    await h.runJob(QA_BLOCK_VECTORS_JOB);
    expect(
      h.state.vectors.filter((vector) => vector.source === VectorSource.QA_DERIVED),
    ).toHaveLength(1);

    // 4. A follow-up question sees the earlier exchange as an anchored
    //    annotation (passage + learner-typed + you-answered), not a chat.
    const followUp = await ask({
      classId: class0?.id ?? 0,
      userId: 7,
      anchorParagraph: 0,
      question: "And a right join?",
    });
    expect(followUp).toEqual(ok({ blockId: 2, status: "PENDING" }));
    await h.runJob(CLASS_QA_ANSWER_JOB);

    const followUpCall = h.state.aiCalls.filter(
      (call) => call.schemaName === "class_qa_answer",
    )[1];
    expect(followUpCall?.prompt).toContain("Earlier questions the learner asked");
    expect(followUpCall?.prompt).toContain('— Passage: "Meet the join."');
    expect(followUpCall?.prompt).toContain('The learner typed: """What is a join?"""');
    expect(followUpCall?.prompt).toContain(
      'You answered: """A left join keeps every left row, matched or not."""',
    );
    // QA_ANSWERED audit captures the full prompt for the usage report.
    expect(
      h.state.events.filter((event) => event.type === EventType.QA_ANSWERED),
    ).toHaveLength(2);
  });

});
