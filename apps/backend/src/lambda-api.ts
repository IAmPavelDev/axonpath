import serverlessHttp from 'serverless-http';
import type { FastifyServerFactoryHandler } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '@/app';

/** serverless-http's invoke function: (API GW event, context) → response. */
type ServerlessInvoke = serverlessHttp.Handler;

// Built once per cold start; reused by every warm invocation.
let cached: Promise<ServerlessInvoke> | null = null;

const bootstrap = async (): Promise<ServerlessInvoke> => {
  const { app, handleRequest } = await buildApp();
  await app.ready();

  // Fastify's raw router takes over everything the shared handler doesn't
  // claim (/health, /ready, /info, 404s) — the same fallback the listening
  // server passes into its serverFactory.
  const fastifyRouting = (
    app as unknown as { routing: FastifyServerFactoryHandler }
  ).routing.bind(app);

  return serverlessHttp((req: IncomingMessage, res: ServerResponse) =>
    handleRequest(req, res, fastifyRouting),
  );
};

export const apiHandler = async (
  event: unknown,
  context: unknown,
): Promise<unknown> => {
  // In-process setImmediate jobs must not hold the invocation open — the
  // freeze would kill them anyway. Durable rows + the scheduled worker
  // recover whatever dies here; claims/leases make replays safe.
  (context as { callbackWaitsForEmptyEventLoop?: boolean })
    .callbackWaitsForEmptyEventLoop = false;

  const invoke = await (cached ??= bootstrap());
  return invoke(event as object, context as object);
};
