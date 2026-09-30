import type { EventType } from "@/prisma/generated";

/**
 * Lightweight audit trail of key domain moments (SKILL_CREATED,
 * CLASS_GENERATED, ANSWER_SUBMITTED, ...). Event rows never gate the flow —
 * persistence failures are logged by the adapter, not surfaced to callers.
 */
export type DomainEvent = {
  skillId: number;
  userId?: number;
  type: EventType;
  payload: Record<string, unknown>;
};

export type EventRepository = {
  record(event: DomainEvent): Promise<void>;
  /**
   * Read side of the audit trail (usage.report): AI generation events for
   * one user — optionally scoped to a skill — oldest first. Payloads are
   * untrusted Json; usage extraction is the caller's job.
   */
  findUsageEvents(
    userId: number,
    skillId?: number,
  ): Promise<
    Array<{
      id: number;
      type: EventType;
      payload: Record<string, unknown>;
      skillId: number;
      createdAt: Date;
    }>
  >;
};
