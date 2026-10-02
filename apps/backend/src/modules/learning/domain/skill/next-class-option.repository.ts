/**
 * The MANUAL-mode candidate-target set for a skill's next lesson. The set is
 * replaced wholesale on every generation and consumed (cleared) when the
 * learner commits a direction — no partial updates, no per-row lifecycle.
 */
export type NextClassOptionRow = {
  id: number;
  /** 1 = the model's best pick. */
  rank: number;
  text: string;
};

export type NextClassOptionRepository = {
  /** Atomically swap the skill's candidate set (delete + insert). */
  replaceForSkill(
    skillId: number,
    options: Array<{ rank: number; text: string }>,
  ): Promise<void>;
  /** Consume the candidate set without replacement. */
  clearForSkill(skillId: number): Promise<void>;
  /** Candidates for the skill, rank ascending. */
  listBySkill(skillId: number): Promise<NextClassOptionRow[]>;
};
