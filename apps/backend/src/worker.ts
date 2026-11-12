import { configureContainer } from "@/container";
import { logger } from "@/lib/logger";

/**
 * Dedicated worker process for the broker-backed deployment: consumes the
 * RabbitMQ job queue and executes handlers against the full container
 * (Prisma, z.ai, Qdrant — same wiring as the API).
 *
 * Sweeper ownership stays with the API process (server mode, started by
 * main.ts after listen); this process is a pure consumer. Delivery is
 * at-least-once with the API-side sweeper reconciliation as the recovery
 * net — handlers must stay idempotent (unchanged contract).
 */
const startWorker = async (): Promise<void> => {
  const container = await configureContainer({ sweeperMode: "worker" });
  const { jobQueue } = container;
  if (!("start" in jobQueue) || typeof jobQueue.start !== "function") {
    logger.error(
      "Worker requires JOB_QUEUE_TRANSPORT=rabbit — the in-process queue cannot be consumed from another process",
    );
    process.exit(1);
  }
  await jobQueue.start();

  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Worker shutting down gracefully");
    try {
      await jobQueue.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Worker shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

  logger.info("Axon worker ready (RabbitMQ consumer)");
};

void startWorker().catch((err) => {
  logger.error({ err }, "Failed to start worker");
  process.exit(1);
});
