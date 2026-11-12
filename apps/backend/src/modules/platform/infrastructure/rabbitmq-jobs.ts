import amqplib from "amqplib";
import { logger } from "@/lib/logger";

import type { JobHandler, JobQueuePort } from "@/modules/platform/ports/jobs";

/**
 * RabbitMQ-backed job queue: same fire-and-forget semantics as the in-process
 * adapter (enqueue never blocks, failures are logged, never propagated), but
 * execution happens in the worker process — durable across API restarts.
 *
 * Topology: one durable queue `<queueName>`, one durable dead-letter queue
 * `<dlqName>`. Messages are `{ jobName, payload }` JSON, persistent, with an
 * `x-attempts` retry header. On handler failure the message is requeued with
 * the attempt count bumped; after `maxAttempts` it is published to the DLQ
 * for manual inspection instead of looping forever.
 *
 * The API process calls only [enqueue] (lazy connection on first publish);
 * the worker process additionally calls [start] to consume. Sweeper
 * reconciliation in the API process remains the at-least-once recovery net:
 * stranded DB state is re-enqueued, so delivery is at-least-once and handlers
 * stay idempotent (same contract as the Lambda era).
 *
 * [amqpConnect] is the test seam: production wires amqplib.connect, tests
 * inject an in-memory channel.
 */
export type AmqpMessageLike = {
  content: Buffer;
  properties?: { headers?: Record<string, unknown> };
};

export interface AmqpChannelLike {
  assertQueue(
    queue: string,
    opts?: { durable?: boolean; arguments?: Record<string, unknown> },
  ): Promise<unknown>;
  prefetch(count: number): void;
  sendToQueue(
    queue: string,
    content: Buffer,
    opts?: { persistent?: boolean; headers?: Record<string, unknown> },
  ): void;
  consume(
    queue: string,
    onMessage: (msg: AmqpMessageLike | null) => void,
  ): Promise<{ consumerTag: string }>;
  ack(msg: AmqpMessageLike): void;
  nack(msg: AmqpMessageLike, allUpTo: boolean, requeue: boolean): void;
}

export interface AmqpConnectionLike {
  createChannel(): Promise<AmqpChannelLike>;
  close(): Promise<void>;
}

export type AmqpConnect = (url: string) => Promise<AmqpConnectionLike>;

export const DEFAULT_AMQP_CONNECT: AmqpConnect = (url) =>
  amqplib.connect(url) as unknown as Promise<AmqpConnectionLike>;

export type RabbitMqJobQueue = JobQueuePort & {
  /** Connects and starts consuming. Worker entrypoint only. */
  start(): Promise<void>;
  /** Resolves when no consumed message is in flight (test/observability). */
  idle(): Promise<void>;
  close(): Promise<void>;
};

export const makeRabbitMqJobQueue = ({
  handlers,
  url,
  amqpConnect = DEFAULT_AMQP_CONNECT,
  queueName = "axon.jobs",
  dlqName = "axon.jobs.dlq",
  maxAttempts = 3,
}: {
  handlers: Record<string, JobHandler>;
  url: string;
  amqpConnect?: AmqpConnect;
  queueName?: string;
  dlqName?: string;
  maxAttempts?: number;
}): RabbitMqJobQueue => {
  let connecting: Promise<AmqpChannelLike> | null = null;
  let connection: AmqpConnectionLike | null = null;
  let channel: AmqpChannelLike | null = null;
  let inFlight = 0;
  let drainWaiters: Array<() => void> = [];

  /** Shared by [idle] and graceful [close] — in-flight drain with waiters. */
  const drain = async (): Promise<void> => {
    if (inFlight === 0) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    drainWaiters.push(resolve);
    return promise;
  };

  const settle = (): void => {
    inFlight -= 1;
    if (inFlight === 0 && drainWaiters.length > 0) {
      const waiters = drainWaiters;
      drainWaiters = [];
      for (const wake of waiters) wake();
    }
  };

  const connect = (): Promise<AmqpChannelLike> => {
    if (channel) return Promise.resolve(channel);
    connecting ??= amqpConnect(url)
      .then(async (conn) => {
        connection = conn;
        const ch = await conn.createChannel();
        await ch.assertQueue(queueName, { durable: true });
        await ch.assertQueue(dlqName, { durable: true });
        await ch.prefetch(1);
        channel = ch;
        return ch;
      })
      .catch((err) => {
        connecting = null;
        throw err;
      });
    return connecting;
  };

  const publish = (
    ch: AmqpChannelLike,
    jobName: string,
    payload: unknown,
    attempts: number,
  ): void => {
    ch.sendToQueue(queueName, Buffer.from(JSON.stringify({ jobName, payload })), {
      persistent: true,
      headers: attempts > 0 ? { "x-attempts": attempts } : undefined,
    });
  };

  const handleMessage = async (msg: AmqpMessageLike): Promise<void> => {
    const ch = await connect();
    let jobName = "<malformed>";
    let payload: unknown;
    try {
      const parsed = JSON.parse(msg.content.toString()) as {
        jobName?: string;
        payload?: unknown;
      };
      jobName = parsed.jobName ?? jobName;
      payload = parsed.payload;
    } catch {
      logger.error({ queue: queueName }, "Unparseable job message — dead-lettering");
      ch.nack(msg, false, false);
      settle();
      return;
    }

    const handler = handlers[jobName];
    if (!handler) {
      logger.error({ jobName }, "Background job handler not registered");
      ch.ack(msg);
      settle();
      return;
    }

    try {
      await Promise.resolve(handler(payload as never));
      ch.ack(msg);
    } catch (err) {
      const attempts =
        typeof msg.properties?.headers?.["x-attempts"] === "number"
          ? (msg.properties.headers["x-attempts"] as number)
          : 0;
      logger.error({ err, jobName, attempts: attempts + 1 }, "Background job failed");
      if (attempts + 1 >= maxAttempts) {
        logger.error({ jobName, attempts: attempts + 1 }, "Job dead-lettered");
        ch.sendToQueue(dlqName, Buffer.from(JSON.stringify({ jobName, payload })), {
          persistent: true,
          headers: { "x-attempts": attempts + 1 },
        });
        ch.ack(msg);
      } else {
        publish(ch, jobName, payload, attempts + 1);
        ch.ack(msg);
      }
    }
    settle();
  };

  return {
    enqueue: (jobName, payload) => {
      const handler = handlers[jobName];
      if (!handler) {
        logger.error({ jobName }, "Background job handler not registered");
        return;
      }
      void connect()
        .then((ch) => publish(ch, jobName, payload, 0))
        .catch((err) =>
          logger.error(
            { err, jobName },
            "Failed to publish job — sweeper will re-enqueue",
          ),
        );
    },

    start: async () => {
      const ch = await connect();
      await ch.consume(queueName, (msg) => {
        if (!msg) return;
        inFlight += 1;
        void handleMessage(msg).catch((err) => {
          logger.error({ err }, "Job consumer crashed on message");
          settle();
        });
      });
      logger.info({ queue: queueName }, "RabbitMQ worker consuming");
    },

    idle: drain,

    close: async () => {
      await drain();
      const openConnection = connection;
      channel = null;
      connecting = null;
      connection = null;
      // Best-effort: graceful shutdown only; a broken socket must not crash.
      await openConnection?.close().catch(() => undefined);
    },
  };
};
