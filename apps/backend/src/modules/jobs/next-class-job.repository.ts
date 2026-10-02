/**
 * Durable queue for next-lesson generation. The row — not the in-memory job —
 * is the source of truth: a server restart loses setImmediate jobs, the row
 * survives in Postgres and is picked up by the minute sweeper.
 */

export type NextClassJobClaim = {
  skillId: number;
  userId: number;
  /** Learner-chosen direction (MANUAL create-class); null = automatic. */
  target: string | null;
  /** Incremented at claim time; the claim's attempt number, 1-based. */
  attempts: number;
  /**
   * Ownership token: set by the claiming UPDATE; completion/requeue only take
   * effect while the claim still owns the row (its lease was not stolen).
   */
  claimedAt: Date;
};

export type NextClassJobRepository = {
  /** Idempotently mark a skill due for its next lesson; resets retries. */
  enqueue(input: { skillId: number; userId: number; target?: string }): Promise<void>;
  /**
   * Atomically claim due jobs: PENDING rows plus PROCESSING rows whose lease
   * expired (the server died mid-run). FOR UPDATE SKIP LOCKED keeps concurrent
   * sweepers / backend instances from ever claiming the same row.
   */
  claim(input: { limit: number; leaseMinutes: number }): Promise<NextClassJobClaim[]>;
  /** Claim one specific skill (the instant in-process trigger). */
  claimOne(input: { skillId: number; leaseMinutes: number }): Promise<NextClassJobClaim | null>;
  /** Drop the marker: the attempt finished (success or final give-up). */
  release(claim: NextClassJobClaim): Promise<void>;
  /** Hand a failed attempt back so a later tick retries it. */
  requeue(claim: NextClassJobClaim): Promise<void>;
  /** Non-mutating check: does the skill already have a queued/running marker? */
  existsPending(skillId: number): Promise<boolean>;
};
