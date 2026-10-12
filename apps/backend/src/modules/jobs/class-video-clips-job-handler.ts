import type { GenerateClassClips } from "@/modules/video/application/generate-class-clips";

export type ClassVideoClipsJobPayload = { classId: number };

/**
 * Lesson clip enrichment: the sweeper claims PENDING classes with a lease,
 * so this handler is a thin fire-and-forget shell. Every failure resolves
 * silently — the attempts budget turns chronically failed classes SKIPPED,
 * which renders the lesson without any video hint.
 */
export const getClassVideoClipsJobHandler =
  (generate: GenerateClassClips) =>
  async (payload: ClassVideoClipsJobPayload) => {
    await generate({ classId: payload.classId });
  };
