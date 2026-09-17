export type SkillListItem = {
    id: number;
    topic: string;
    description: string;
    status: string;
    userId: number;
    lambda: number;
    requestId: number | null;
    createdAt: Date;
    updatedAt: Date;
    lessonCount: number;
    completedLessons: number;
    learnedPoints: number;
    lastActivityAt: Date | null;
  };

export type SkillRepository = {
  create(input: { userId: number; topic: string }): Promise<{
    id: number;
    status: string;
  }>;
  update(
    id: number,
    patch: { topic?: string; description?: string },
  ): Promise<{ id: number; topic: string; description: string; status: string }>;
  findById(id: number): Promise<{
    id: number;
    topic: string;
    description: string;
    status: string;
  } | null>;
  listByUser(userId: number): Promise<SkillListItem[]>;
};
