import { logger } from "@/lib/logger";

import { buildApp } from "@/app";

// Server mode: long-lived listener (EC2 container today, dev compose). The
// Lambda entrypoints live in lambda-api.ts / lambda-worker.ts and share the
// same buildApp().
const startServer = async (): Promise<void> => {
  try {
    const { app, container } = await buildApp();

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      app.log.info(`Received ${signal}, shutting down gracefully`);

      try {
        container.nextClassSweeper.stop();
        container.classQaSweeper.stop();
        container.skillInitSweeper.stop();
        container.gradingSweeper.stop();
        await app.close();
        app.log.info("Server closed successfully");
        process.exit(0);
      } catch (error) {
        app.log.error("Error during shutdown: " + error);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Start server
    const address = await app.listen({
      port: parseInt(app.config.PORT, 10),
      host: app.config.HOST,
    });
    // Background processing starts only after the server is listening; the
    // boot ticks recover work orphaned by a previous restart: next-class
    // jobs from their durable rows, class-qa answers from stranded PENDING
    // blocks whose in-process job died with the old process.
    container.nextClassSweeper.start();
    container.classQaSweeper.start();
    container.skillInitSweeper.start();
    container.gradingSweeper.start();
    container.recommendationsSweeper.start();
    container.classClipsSweeper.start();

    app.log.info(`Server running in ${app.config.NODE_ENV} mode`);
    app.log.info(`Server listening at ${address}`);
    app.log.info(`Health check: ${address}/health`);
    app.log.info(`Documentation: ${address}/`);
  } catch (err) {
    logger.error("Failed to start server: " + err);
    process.exit(1);
  }
};

startServer();
