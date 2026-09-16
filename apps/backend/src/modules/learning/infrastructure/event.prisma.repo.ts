import { Prisma } from "@/prisma/generated";
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
      console.error({ err, eventType: event.type, skillId: event.skillId }, "Failed to record event");
    }
  },
});
