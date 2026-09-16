/**
 * Class — one ordered lesson inside a skill. The `(skillId, index)` pair is
 * unique; index 0 is the AI-generated initial class.
 */
export type Class = {
  id: number;
  skillId: number;
  index: number;
  title: string;
  contentMd: string;
  aiModel: string | null;
};

export type ClassListItem = {
  id: number;
  title: string;
};

export type ClassError = { kind: "ClassNotFound"; classId: number };
