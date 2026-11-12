import { describe, expect, it, vi } from "vitest";

import {
  makeRabbitMqJobQueue,
  type AmqpChannelLike,
  type AmqpConnectionLike,
  type AmqpMessageLike,
} from "./rabbitmq-jobs";

/**
 * In-memory channel fake capturing publishes/consumes so the adapter's
 * dispatch, retry, and dead-letter behavior is testable without a broker.
 * Mirrors the real amqp surface the adapter touches.
 */
const makeFakeChannel = () => {
  let onMessage: ((msg: AmqpMessageLike | null) => void) | null = null;
  const published: Array<{
    queue: string;
    body: { jobName: string; payload: unknown };
    headers: Record<string, unknown>;
  }> = [];
  const acked: AmqpMessageLike[] = [];
  const nacked: Array<{ msg: AmqpMessageLike; requeue: boolean }> = [];
  const handler = vi.fn(async () => undefined);

  const channel: AmqpChannelLike = {
    assertQueue: async () => undefined,
    prefetch: () => undefined,
    sendToQueue: (queue, content, opts) => {
      published.push({
        queue,
        body: JSON.parse(content.toString()),
        headers: (opts?.headers ?? {}) as Record<string, unknown>,
      });
    },
    consume: async (_queue, cb) => {
      onMessage = cb;
      return { consumerTag: "test" };
    },
    ack: (msg) => {
      acked.push(msg);
    },
    nack: (msg, _all, requeue) => {
      nacked.push({ msg, requeue });
    },
  };

  const connection: AmqpConnectionLike = {
    createChannel: async () => channel,
    close: async () => undefined,
  };

  /** Deliver a raw message to the consumer the adapter registered. */
  const deliver = (jobName: string, payload: unknown, attempts = 0): void => {
    if (!onMessage) throw new Error("consumer not started");
    onMessage({
      content: Buffer.from(JSON.stringify({ jobName, payload })),
      properties: {
        headers: attempts > 0 ? { "x-attempts": attempts } : undefined,
      },
    });
  };

  return { handler, connection, published, acked, nacked, deliver };
};

describe("rabbitmq job queue", () => {
  it("enqueue publishes persistent JSON with the job name and no attempt header", async () => {
    const fake = makeFakeChannel();
    const queue = makeRabbitMqJobQueue({
      handlers: { TASK: fake.handler },
      url: "amqp://test",
      amqpConnect: async () => fake.connection,
    });

    queue.enqueue("TASK", { id: 1 });
    await vi.waitUntil(() => fake.published.length === 1);

    expect(fake.published).toEqual([
      {
        queue: "axon.jobs",
        body: { jobName: "TASK", payload: { id: 1 } },
        headers: {},
      },
    ]);
  });

  it("start consumes: success is dispatched and acknowledged once", async () => {
    const fake = makeFakeChannel();
    const queue = makeRabbitMqJobQueue({
      handlers: { TASK: fake.handler },
      url: "amqp://test",
      amqpConnect: async () => fake.connection,
    });

    await queue.start();
    fake.deliver("TASK", { id: 2 });
    await queue.idle();

    expect(fake.handler).toHaveBeenCalledWith({ id: 2 });
    expect(fake.acked).toHaveLength(1);
    expect(fake.nacked).toHaveLength(0);
    expect(fake.published).toHaveLength(0);
  });

  it("failure requeues with attempts bumped; exhausting attempts dead-letters to the DLQ", async () => {
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    const fake = makeFakeChannel();
    fake.handler.mockImplementation(failing);
    const queue = makeRabbitMqJobQueue({
      handlers: { TASK: fake.handler },
      url: "amqp://test",
      amqpConnect: async () => fake.connection,
      maxAttempts: 3,
    });
    await queue.start();

    // Attempt 0 → requeue at attempts=1.
    fake.deliver("TASK", { id: 3 });
    await queue.idle();
    expect(fake.published).toEqual([
      expect.objectContaining({
        queue: "axon.jobs",
        headers: { "x-attempts": 1 },
      }),
    ]);

    // Final attempt → DLQ, no further requeue.
    fake.deliver("TASK", { id: 3 }, 2);
    await queue.idle();
    const dlq = fake.published.filter((p) => p.queue === "axon.jobs.dlq");
    expect(dlq).toEqual([
      {
        queue: "axon.jobs.dlq",
        body: { jobName: "TASK", payload: { id: 3 } },
        headers: { "x-attempts": 3 },
      },
    ]);
  });

  it("unregistered job names are acked and dropped, never requeued", async () => {
    const fake = makeFakeChannel();
    const queue = makeRabbitMqJobQueue({
      handlers: {},
      url: "amqp://test",
      amqpConnect: async () => fake.connection,
    });
    await queue.start();

    fake.deliver("NOPE", {});
    await queue.idle();

    expect(fake.acked).toHaveLength(1);
    expect(fake.nacked).toHaveLength(0);
    expect(fake.published).toHaveLength(0);
  });

  it("enqueue to a down broker logs and drops — sweeper reconciliation covers it", async () => {
    const fake = makeFakeChannel();
    const queue = makeRabbitMqJobQueue({
      handlers: { TASK: fake.handler },
      url: "amqp://test",
      amqpConnect: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    expect(() => queue.enqueue("TASK", { id: 4 })).not.toThrow();
    await queue.idle();
    expect(fake.published).toHaveLength(0);
  });
});
