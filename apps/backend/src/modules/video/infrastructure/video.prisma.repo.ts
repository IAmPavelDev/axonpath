import { prisma } from "@/modules/platform/infrastructure/prisma";

import type {
  ClassClipRow,
  ClassClipStatus,
  NewClassClip,
  RecommendationRow,
  RecommendationStatus,
  VideoAssetRow,
  VideoRepository,
} from "@/modules/video/domain/video-repos";

const parseTranscript = (raw: unknown): VideoAssetRow["transcript"] => {
  if (!Array.isArray(raw)) return null;
  const segments: NonNullable<VideoAssetRow["transcript"]> = [];
  for (const entry of raw) {
    const rec = entry as { startSeconds?: unknown; endSeconds?: unknown; text?: unknown };
    if (typeof rec.startSeconds !== "number" || typeof rec.text !== "string") continue;
    segments.push({
      startSeconds: rec.startSeconds,
      endSeconds: typeof rec.endSeconds === "number" ? rec.endSeconds : null,
      text: rec.text,
    });
  }
  return segments.length > 0 ? segments : null;
};

export const makeVideoRepository = (): VideoRepository => ({
  claimStaleRecommendationSkills: (olderThan) =>
    prisma.$queryRaw`
      UPDATE "Skill" AS skill
      SET "updatedAt" = NOW(), "recommendationsAttempts" = skill."recommendationsAttempts" + 1
      WHERE skill."recommendationsStatus" = 'PENDING'
        AND skill."updatedAt" < ${olderThan}
      RETURNING skill."id", skill."topic"
    `,

  getRecommendationsState: async (skillId) => {
    const skill = await prisma.skill.findUnique({
      where: { id: skillId },
      select: { recommendationsStatus: true, recommendationsAttempts: true },
    });
    return {
      status: (skill?.recommendationsStatus as RecommendationStatus | null) ?? null,
      attempts: skill?.recommendationsAttempts ?? 0,
    };
  },

  findSkillTopic: async (skillId) => {
    const skill = await prisma.skill.findUnique({
      where: { id: skillId },
      select: { topic: true },
    });
    return skill?.topic ?? null;
  },

  findSkillOwner: async (skillId) => {
    const skill = await prisma.skill.findUnique({
      where: { id: skillId },
      select: { userId: true },
    });
    return skill?.userId ?? null;
  },

  setRecommendationsStatus: async (skillId, status) => {
    await prisma.skill.update({
      where: { id: skillId },
      data: {
        recommendationsStatus: status,
        // Re-arming a FAILED skill starts a fresh attempts budget.
        ...(status === "PENDING" ? { recommendationsAttempts: 0 } : {}),
      },
    });
  },

  replaceRecommendations: async (skillId, items) => {
    await prisma.$transaction([
      prisma.skillRecommendation.deleteMany({ where: { skillId } }),
      prisma.skillRecommendation.createMany({
        data: items.map((item) => ({ ...item, skillId })),
      }),
    ]);
  },

  findRecommendations: async (skillId) => {
    const rows = await prisma.skillRecommendation.findMany({
      where: { skillId },
      orderBy: { rank: "asc" },
    });
    return rows.map(
      (row): RecommendationRow => ({
        id: row.id,
        videoId: row.videoId,
        title: row.title,
        channel: row.channel,
        durationSeconds: row.durationSeconds,
        rank: row.rank,
        score: row.score,
      }),
    );
  },

  failStaleClipClasses: async (maxAttempts) => {
    await prisma.$queryRaw`
      UPDATE "Class"
      SET "clipStatus" = 'SKIPPED'
      WHERE "clipStatus" = 'PENDING' AND "clipAttempts" >= ${maxAttempts}
    `;
  },

  claimStaleClipClasses: async (olderThan) => {
    return prisma.$queryRaw<Array<{ id: number; skillId: number }>>`
      UPDATE "Class" AS klass
      SET "clipLeaseAt" = NOW(), "clipAttempts" = klass."clipAttempts" + 1
      WHERE klass."clipStatus" = 'PENDING'
        AND (klass."clipLeaseAt" IS NULL OR klass."clipLeaseAt" < ${olderThan})
      RETURNING klass."id", klass."skillId"
    `;
  },

  setClipStatus: async (classId, status: ClassClipStatus) => {
    await prisma.class.update({ where: { id: classId }, data: { clipStatus: status } });
  },

  findClassForClips: async (classId) => {
    const klass = await prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, title: true, contentMd: true, skill: { select: { topic: true } } },
    });
    if (!klass) return null;
    return {
      id: klass.id,
      title: klass.title,
      contentMd: klass.contentMd,
      skillTopic: klass.skill.topic,
    };
  },

  replaceClassClips: async (classId, clips: NewClassClip[]) => {
    await prisma.$transaction([
      prisma.classVideoClip.deleteMany({ where: { classId } }),
      prisma.classVideoClip.createMany({ data: clips.map((clip) => ({ ...clip, classId })) }),
    ]);
  },

  findClassClips: async (classId) => {
    const rows = await prisma.classVideoClip.findMany({
      where: { classId },
      orderBy: { anchorParagraph: "asc" },
    });
    return rows.map(
      (row): ClassClipRow => ({
        id: row.id,
        anchorParagraph: row.anchorParagraph,
        videoId: row.videoId,
        title: row.title,
        channel: row.channel,
        startSeconds: row.startSeconds,
        endSeconds: row.endSeconds,
        transcriptExcerpt: row.transcriptExcerpt,
        concept: row.concept,
      }),
    );
  },

  getClassClipState: async (classId) => {
    const klass = await prisma.class.findUnique({
      where: { id: classId },
      select: { clipStatus: true },
    });
    const clips = await prisma.classVideoClip.findMany({
      where: { classId },
      orderBy: { anchorParagraph: "asc" },
    });
    return {
      clipStatus: (klass?.clipStatus as ClassClipStatus) ?? "SKIPPED",
      clips: clips.map(
        (row): ClassClipRow => ({
          id: row.id,
          anchorParagraph: row.anchorParagraph,
          videoId: row.videoId,
          title: row.title,
          channel: row.channel,
          startSeconds: row.startSeconds,
          endSeconds: row.endSeconds,
          transcriptExcerpt: row.transcriptExcerpt,
          concept: row.concept,
        }),
      ),
    };
  },

  findVideoAsset: async (videoId) => {
    const row = await prisma.videoAsset.findUnique({ where: { videoId } });
    if (!row) return null;
    return {
      videoId: row.videoId,
      title: row.title,
      channel: row.channel,
      durationSeconds: row.durationSeconds,
      transcript: parseTranscript(row.transcript),
    } satisfies VideoAssetRow;
  },

  upsertVideoAsset: async (asset) => {
    await prisma.videoAsset.upsert({
      where: { videoId: asset.videoId },
      create: { ...asset, status: "DISCOVERED" },
      update: {
        title: asset.title,
        channel: asset.channel,
        durationSeconds: asset.durationSeconds,
      },
    });
  },
});
