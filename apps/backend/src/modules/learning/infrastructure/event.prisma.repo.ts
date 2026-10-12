import { logger } from "@/lib/logger";

import { EventType, Prisma } from "@/prisma/generated";
import { prisma } from "@/modules/platform/infrastructure/prisma";
import type {
  DomainEvent,
  EventRepository,
} from "@/modules/learning/domain/event/event.repository";

export const makePrismaEventRepository = (): EventRepository => ({
  record: async (event: DomainEvent) => {
    try {
      await prisma.event.create({
        data: {
          skillId: event.skillId,
          userId: event.userId,
          type: event.type,
          payload: event.payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Audit events must never gate the flow that produced them.
      logger.error({ err, eventType: event.type, skillId: event.skillId }, "Failed to record event");
    }
  },

  findUsageEvents: async (userId, skillId) => {
    const rows = await prisma.event.findMany({
      where: {
        userId,
        type: {
          in: [EventType.SKILL_CREATED, EventType.CLASS_GENERATED, EventType.QA_ANSWERED],
        },
        ...(skillId !== undefined ? { skillId } : {}),
      },
      select: { id: true, type: true, payload: true, skillId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      skillId: row.skillId,
      createdAt: row.createdAt,
    }));
  },
});
