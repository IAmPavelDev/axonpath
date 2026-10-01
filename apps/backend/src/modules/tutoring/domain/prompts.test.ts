import { describe, expect, it } from "vitest";
import {
  buildGradingPrompt,
  buildInitSkillPrompt,
  buildNextClassPrompt,
  buildQaAnswerPrompt,
  buildSkillDescriptionPrompt,
} from "./prompts";
import { DESCRIPTION_SYSTEM, GRADER_SYSTEM, QA_TUTOR_SYSTEM, TUTOR_SYSTEM } from "./personas";

/**
 * Phase 8 D6: author attribution is a test-asserted contract. Learner-typed
 * strings are fenced under "The learner typed"; Axon-authored content is
 * labeled as Axon's. A builder that swaps or drops a label breaks here.
 */
describe("author attribution (D6)", () => {
  it("labels the typed topic as learner input in the description prompt", () => {
    const prompt = buildSkillDescriptionPrompt("SQL joins");
    expect(prompt).toContain("The learner typed this topic:");
    expect(prompt).toContain('"""SQL joins"""');
  });

  it("labels topic + prior context by author in the init prompt", () => {
    const prompt = buildInitSkillPrompt({
      topic: "SQL joins",
      priorContext: ["Already comfortable with SELECT filters"],
    });
    expect(prompt).toContain('"""SQL joins"""');
    expect(prompt).toContain(
      "Notes Axon wrote about this learner in previous skills (its observations, not the learner's own claims)",
    );
  });

  it("labels authors in the next-class prompt mistakes and history", () => {
    const prompt = buildNextClassPrompt({
      topic: "SQL joins",
      lastTitle: "Joins from zero",
      history: [
        { textSnippet: "Inner joins were covered", source: "AI_NEXT" },
        { textSnippet: "Comfortable with filters", source: "AI_INITIAL" },
        { textSnippet: "Struggled with LEFT JOIN filters", source: "ANSWER_DERIVED" },
        {
          textSnippet:
            'The learner asked: """Why left joins?""" while reading the lesson "Joins"; Axon\'s answer explained: predicate semantics.',
          source: "QA_DERIVED",
        },
      ],
      mistakes: [
        {
          questionText: "What does LEFT JOIN do?",
          userAnswer: "Filters rows",
          correctAnswer: "Keeps unmatched left rows",
        },
      ],
      allCorrect: false,
    });
    expect(prompt).toContain('"""SQL joins"""');
    expect(prompt).toContain("Previous lesson (Axon-generated):");
    expect(prompt).toContain("Lessons already covered (Axon's own summaries)");
    expect(prompt).toContain("Notes Axon wrote about this learner (observations, not the learner's own claims)");
    expect(prompt).toContain("Known gaps — from the learner's wrong quiz answers (notes written by Axon)");
    expect(prompt).toContain(
      "Questions the learner asked Axon in past lessons (the learner's typed questions with Axon's answers, mined by Axon)",
    );
    expect(prompt).toContain("- Question (Axon generated): What does LEFT JOIN do?");
    expect(prompt).toContain('The learner typed: """Filters rows"""');
    expect(prompt).toContain('The lesson\'s correct answer: """Keeps unmatched left rows"""');
    // The old unattributed labels are gone.
    expect(prompt).not.toContain("Their answer:");
    expect(prompt).not.toContain("Correct answer:");
  });

  it("labels authors in the grading prompt", () => {
    const prompt = buildGradingPrompt({
      attempts: [
        {
          answerId: 9,
          questionText: "Explain left joins.",
          modelAnswer: "Left joins keep every left row.",
          learnerAnswer: "They drop rows.",
        },
      ],
    });
    expect(prompt).toContain("Question (Axon generated): Explain left joins.");
    expect(prompt).toContain("Model answer (Axon wrote): Left joins keep every left row.");
    expect(prompt).toContain('The learner typed: """They drop rows."""');
    expect(prompt).not.toContain("Learner answer:");
  });

  it("carries the attribution rule in every persona", () => {
    for (const persona of [DESCRIPTION_SYSTEM, TUTOR_SYSTEM, QA_TUTOR_SYSTEM, GRADER_SYSTEM]) {
      expect(persona).toContain("Attribution: every text you receive carries an author label.");
      expect(persona).toContain("never merge the two roles");
    }
  });
});

describe("buildQaAnswerPrompt (Phase 8 D1)", () => {
  const base = {
    lessonTitle: "Joins",
    skillTitle: "SQL joins",
    skillDescription: "Learn SQL joins by doing.",
    siblingTitles: ["Aggregates"],
    anchorParagraph: 1,
    anchorExcerpt: "a left join keeps every left row",
    question: "When does a left join drop rows?",
    contentMd: "## Introduction\nMeet the join.",
    history: [],
    skillHits: [],
    crossHits: [],
  };

  it("orders the layers: preamble, skill frame, quote, question, lesson, history, memory", () => {
    const prompt = buildQaAnswerPrompt({
      ...base,
      history: [
        { anchorExcerpt: "Meet the join.", question: "What is a join?", answer: "Rows matched in both." },
      ],
      skillHits: [{ textSnippet: "Notes on outer joins", source: "CONTENT_CHUNK" }],
      crossHits: [{ textSnippet: "Comfortable with filters", source: "AI_INITIAL" }],
    });

    const idx = (marker: string) => prompt.indexOf(marker);
    expect(idx("This request has labeled blocks")).toBe(0);
    expect(idx("Document model:")).toBeLessThan(idx("Lesson: Joins"));
    expect(idx("Lesson: Joins")).toBeLessThan(idx("The learner selected this passage"));
    expect(idx("The learner selected this passage")).toBeLessThan(idx("The learner typed:"));
    expect(idx("The learner typed:")).toBeLessThan(idx("Lesson content (markdown), written by Axon:"));
    expect(idx("Lesson content (markdown), written by Axon:")).toBeLessThan(idx("Earlier questions the learner asked"));
    expect(idx("Earlier questions the learner asked")).toBeLessThan(idx("Background memory"));
    expect(idx("Background memory")).toBeLessThan(idx("Answer the learner's typed question"));
  });

  it("renders history blocks as passage → learner-typed → you-answered annotations", () => {
    const prompt = buildQaAnswerPrompt({
      ...base,
      history: [
        { anchorExcerpt: "Meet the join.", question: "What is a join?", answer: "Rows matched in both." },
        { anchorExcerpt: null, question: "Why?", answer: "Because predicates." },
      ],
    });

    expect(prompt).toContain('— Passage: "Meet the join."');
    expect(prompt).toContain('The learner typed: """What is a join?"""');
    expect(prompt).toContain('You answered: """Rows matched in both."""');
    // Out-of-range anchor (null excerpt) omits the passage line, keeps Q/A.
    expect(prompt).toContain('  The learner typed: """Why?"""');
    expect(prompt).toContain('You answered: """Because predicates."""');
    expect(prompt).toContain("not a dialogue to continue");
  });

  it("caps the history layer and long fields", () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      anchorExcerpt: `passage ${i}`,
      question: `q ${i}`,
      answer: "a".repeat(2000),
    }));
    const prompt = buildQaAnswerPrompt({
      ...base,
      history: entries,
      siblingTitles: ["x".repeat(1000)],
      anchorExcerpt: "y".repeat(1000),
    });

    expect(prompt).not.toContain("q 5");
    // Answers, anchor excerpts and the sibling line are clamped with an ellipsis.
    const answerLines = prompt.split("\n").filter((line) => line.startsWith("  You answered:"));
    for (const line of answerLines) {
      expect(line.length).toBeLessThan(800);
    }
    expect(prompt).toContain("…");
  });

  it("omits the selection block and sibling line when absent", () => {
    const prompt = buildQaAnswerPrompt({
      ...base,
      anchorExcerpt: null,
      siblingTitles: [],
    });
    expect(prompt).not.toContain("The learner selected this passage");
    expect(prompt).not.toContain("Other lessons in this skill");
    expect(prompt).toContain("The learner typed:");
  });

  it("omits the memory layer when both hit groups are empty", () => {
    const prompt = buildQaAnswerPrompt(base);
    expect(prompt).not.toContain("Background memory");
  });
});
