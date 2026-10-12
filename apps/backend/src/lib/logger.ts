import pino from "pino";

/**
 * Single pino instance for the whole backend (Fastify request logs, RPC
 * request logs, sweepers/jobs). Output is newline-delimited JSON on stdout —
 * Lambda ships it to CloudWatch Logs, where metric filters key on the
 * numeric `level` field (50=error, 60=fatal → Axon/Backend Errors metric).
 */
const isProduction = process.env.NODE_ENV === "production";

// Pretty output only for interactive dev sessions. A transport spawns worker
// threads — never acceptable inside Lambda or vitest.
const transport =
  !isProduction && process.stdout.isTTY
    ? { target: "pino-pretty", options: { singleLine: true } }
    : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { role: process.env.LAMBDA_ROLE ?? "server" },
  ...(transport ? { transport } : {}),
});
