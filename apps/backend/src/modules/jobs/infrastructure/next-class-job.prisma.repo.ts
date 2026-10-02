import { prisma } from "@/modules/platform/infrastructure/prisma";
import type { NextClassJobRepository } from "@/modules/jobs/next-class-job.repository";
type ClaimRow = {
  skillId: number;
  userId: number;
  target: string | null;
  attempts: number;
  claimedAt: Date;
};
export const makePrismaNextClassJobRepository = (): NextClassJobRepository => ({
  enqueue: async ({ skillId, userId, target = null }) => {
    // Upsert on the skillId unique: a quiz retake re-arms the marker instead
    // of stacking duplicates.
    await prisma.nextClassJob.upsert({
      where: { skillId },
      create: { skillId, userId, target },
      update: { userId, target, status: "PENDING", attempts: 0, claimedAt: null },
    });
  },

  // Atomic claim of due rows in one statement: a row is claimable when
  // PENDING, or when PROCESSING with an expired lease (the previous owner
  // died — server restart / crash — and must not block the skill forever).
  // FOR UPDATE SKIP LOCKED makes concurrent claimants (sweeper ticks, instant
  // triggers, other backend instances) serialize per row without doubling work.
  claim: ({ limit, leaseMinutes }) =>
    prisma.$queryRaw<ClaimRow[]>`
      UPDATE "NextClassJob" AS job
      SET "status" = 'PROCESSING', "claimedAt" = NOW(), "attempts" = job."attempts" + 1
      FROM (
        SELECT "id" FROM "NextClassJob"
        WHERE "status" = 'PENDING'
           OR ("status" = 'PROCESSING'
               AND "claimedAt" < NOW() - make_interval(mins => ${leaseMinutes}::int))
        ORDER BY "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ) AS due
      WHERE job."id" = due."id"
      RETURNING job."skillId", job."userId", job."target", job."attempts", job."claimedAt"
    `,

  claimOne: async ({ skillId, leaseMinutes }) => {
    const rows = await prisma.$queryRaw<ClaimRow[]>`
      UPDATE "NextClassJob"
      SET "status" = 'PROCESSING', "claimedAt" = NOW(), "attempts" = "attempts" + 1
      WHERE "skillId" = ${skillId}
        AND ("status" = 'PENDING'
            OR ("status" = 'PROCESSING'
                AND "claimedAt" < NOW() - make_interval(mins => ${leaseMinutes}::int)))
      RETURNING "skillId", "userId", "target", "attempts", "claimedAt"
    `;
    return rows[0] ?? null;
  },

  release: async ({ skillId, claimedAt }) => {
    // Guarded by claimedAt: if our lease was stolen, we no longer own the row
    // and must not drop the new owner's marker.
    await prisma.nextClassJob.deleteMany({
      where: { skillId, status: "PROCESSING", claimedAt },
    });
  },

  requeue: async ({ skillId, claimedAt }) => {
    await prisma.nextClassJob.updateMany({
      where: { skillId, status: "PROCESSING", claimedAt },
      data: { status: "PENDING" },
    });
  },

  existsPending: async (skillId) => {
    const count = await prisma.nextClassJob.count({
      where: { skillId, status: { in: ["PENDING", "PROCESSING"] } },
    });
    return count > 0;
  },
});
