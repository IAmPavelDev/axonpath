import type { SkillStatus } from "@/prisma/generated";
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
  create(input: { userId: number; topic: string; status: SkillStatus }): Promise<{
    id: number;
    status: string;
  }>;
  update(
    id: number,
    patch: { topic?: string; description?: string; status?: SkillStatus },
  ): Promise<{ id: number; topic: string; description: string; status: string }>;
  findById(id: number): Promise<{
    id: number;
    topic: string;
    description: string;
    status: string;
    userId: number;
  } | null>;
  listByUser(userId: number): Promise<SkillListItem[]>;
};
