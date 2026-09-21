import { describe, expect, it } from "vitest";
import { EventType, SkillStatus, VectorSource } from "@/prisma/generated";
import { ok, unwrapOrThrow } from "@/modules/platform/result";
import {
  SKILL_INIT_JOB,
  makeCreateSkill,
} from "@/modules/learning/application/commands/create-skill";
import { makeSubmitQuiz } from "@/modules/learning/application/commands/submit-quiz";
import { makeRetrySkill } from "@/modules/learning/application/commands/retry-skill";
import {
  SKILL_NEXT_CLASS_JOB,
} from "@/modules/tutoring/application/generate-next-class";
import {
  classesOfSkill,
  firstQuestionOfType,
  makeLoopHarness,
} from "@/modules/testing/fakes";

/**
 * The composed adaptive loop: the REAL use cases (create, init, submit,
 * next-class, retry) and the REAL job registry wired over in-memory fakes.
 * This is the CI-able version of the manual smoke test — beta acceptance §3.
 */
describe("adaptive loop integration", () => {
  it("runs create → init → submit → next-class, then dedups a consecutive retake", async () => {
    const h = makeLoopHarness();
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });

    // 1. Create → GENERATING; init job → ACTIVE with class 0, questions,
    //    AI_NEXT summary vector and AI_INITIAL snippet vectors.
    const created = await createSkill({ userId: 7, topic: "SQL joins" });
    expect(created).toEqual(ok({ id: 1, status: SkillStatus.GENERATING }));
    const skillId = unwrapOrThrow(created).id;

    await h.runJob(SKILL_INIT_JOB);

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

    // 2. Submit with one deliberate wrong answer → scored, next-class enqueued.
    const submitQuiz = makeSubmitQuiz({
      quizRepo: h.deps.quizRepo,
      eventRepo: h.deps.eventRepo,
      jobs: h.jobs,
    });
    const trueFalse = firstQuestionOfType(h, class0[0]?.id ?? 0, "TRUE_FALSE");
    expect(trueFalse).toBeDefined();

    const submitted = await submitQuiz({
      classId: class0[0]?.id ?? 0,
      userId: 7,
      answers: [{ questionId: trueFalse?.id ?? 0, answer: "False" }],
    });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.value).toMatchObject({
        score: 0,
        total: 1,
        perQuestion: [
          { isCorrect: false, correctAnswer: "True" },
        ],
      });
    }
    expect(h.state.enqueued.at(-1)).toEqual({
      jobName: SKILL_NEXT_CLASS_JOB,
      payload: { skillId, userId: 7 },
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

    const generated = h.state.events.filter(
      (event) => event.type === EventType.CLASS_GENERATED,
    );
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({ skillId, userId: 7 });
    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);

    // 4. Retake the same quiz → the next-class handler no-ops (D3 dedup):
    //    no class 2, no event, no AI call.
    await submitQuiz({
      classId: class0[0]?.id ?? 0,
      userId: 7,
      answers: [{ questionId: trueFalse?.id ?? 0, answer: "False" }],
    });
    await h.runJob(SKILL_NEXT_CLASS_JOB);

    expect(classesOfSkill(h, skillId)).toHaveLength(2);
    expect(
      h.state.aiCalls.filter((call) => call.schemaName === "next_class"),
    ).toHaveLength(1);
    expect(
      h.state.events.filter((event) => event.type === EventType.CLASS_GENERATED),
    ).toHaveLength(1);
  });

  it("heals a FAILED init through retry when nothing was persisted", async () => {
    // 5. Scripted AI failure before any persist → FAILED + ERROR_OCCURRED.
    const h = makeLoopHarness({ failOnceOn: "init_skill" });
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    const created = await createSkill({ userId: 7, topic: "SQL joins" });
    const skillId = unwrapOrThrow(created).id;

    await h.runJob(SKILL_INIT_JOB);

    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.FAILED);
    expect(h.state.events).toHaveLength(1);
    expect(h.state.events[0]).toMatchObject({ type: EventType.ERROR_OCCURRED, skillId });
    expect(classesOfSkill(h, skillId)).toHaveLength(0);

    // skill.retry → GENERATING + a fresh skill-init job with the create payload.
    const retrySkill = makeRetrySkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    const retried = await retrySkill({ skillId, userId: 7 });
    expect(retried).toEqual(ok({ status: SkillStatus.GENERATING }));
    expect(h.state.enqueued.at(-1)?.jobName).toBe(SKILL_INIT_JOB);

    await h.runJob(SKILL_INIT_JOB);

    // The retry ran a full regeneration (init AI called a second time).
    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);
    expect(classesOfSkill(h, skillId)).toHaveLength(1);
    expect(
      h.state.aiCalls.filter((call) => call.schemaName === "init_skill"),
    ).toHaveLength(2);
  });

  it("heals a partial persist through retry without regenerating", async () => {
    // Embeddings fail AFTER the class was persisted: FAILED with class 0
    // present. The init retry guard skips generation and heals to ACTIVE —
    // no duplicate class, no new AI calls (D2).
    const h = makeLoopHarness({ failEmbeddingsOnce: true });
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    const created = await createSkill({ userId: 7, topic: "SQL joins" });
    const skillId = unwrapOrThrow(created).id;

    await h.runJob(SKILL_INIT_JOB);

    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.FAILED);
    expect(classesOfSkill(h, skillId)).toHaveLength(1);

    const retrySkill = makeRetrySkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    await retrySkill({ skillId, userId: 7 });
    await h.runJob(SKILL_INIT_JOB);

    expect(h.state.skills.get(skillId)?.status).toBe(SkillStatus.ACTIVE);
    expect(classesOfSkill(h, skillId)).toHaveLength(1);
    expect(
      h.state.aiCalls.filter((call) => call.schemaName === "init_skill"),
    ).toHaveLength(1);
    // First run: SKILL_CREATED audit + ERROR_OCCURRED. The healed run adds
    // nothing — the guard short-circuits before any event is recorded.
    expect(
      h.state.events.filter((event) => event.type === EventType.ERROR_OCCURRED),
    ).toHaveLength(1);
  });

  it("refuses a retry the user does not own or from a non-FAILED state", async () => {
    const h = makeLoopHarness();
    const createSkill = makeCreateSkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });
    const created = await createSkill({ userId: 7, topic: "SQL joins" });
    const skillId = unwrapOrThrow(created).id;
    await h.runJob(SKILL_INIT_JOB); // → ACTIVE

    const retrySkill = makeRetrySkill({ skillRepo: h.deps.skillRepo, jobs: h.jobs });

    const notOwner = await retrySkill({ skillId, userId: 99 });
    expect(notOwner).toEqual({ ok: false, error: { kind: "NotOwned", skillId } });

    const notFailed = await retrySkill({ skillId, userId: 7 });
    expect(notFailed).toEqual({
      ok: false,
      error: { kind: "InvalidSkillTransition", from: SkillStatus.ACTIVE, to: SkillStatus.GENERATING },
    });
  });
});
