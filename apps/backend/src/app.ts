import fastify from 'fastify';
import type { FastifyError } from 'fastify';
import { logger } from '@/lib/logger';
import sensible from '@fastify/sensible';
import env from '@fastify/env';
import { buildApiHandlers } from '@router/index';
import { registerApiRoutes } from '@/lib/routes';
import { makeAuthHookDeps } from '@/lib/auth-hook';
// The committed contract artifact (D4) — emitted by the api-contract build,
// which must run first (repo build-order rule).
import spec from '@axon/api-contract/dist/openapi.json';

// Wiring: container (repositories/use cases/jobs) → handler registry →
// Fastify routes generated from the contract route table.
import { configureContainer } from './container';

interface AppConfig {
  PORT: string;
  NODE_ENV: string;
  HOST: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

const SCALAR_DOCS_HTML = `
  <!doctype html>
  <html>
    <head>
      <title>My Client</title>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" type="image/svg+xml" href="https://scalar.com/favicon.svg" />
    </head>
    <body>
      <div id="app"></div>
      <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
      <script>
        Scalar.createApiReference('#app', {
          url: '/spec.json',
          authentication: {
            securitySchemes: {
              bearerAuth: {
                token: 'default-token',
              },
            },
          },
        })
      </script>
    </body>
  </html>
`;

/**
 * Build the whole app exactly once, shared by both entrypoints:
 * - main.ts: `app.listen` on the container (long-lived server, dev compose).
 * - lambda-api.ts: no listen; the serverless-http wrapper drives
 *   `app.routing` directly.
 */
export const buildApp = async () => {
  const container = configureContainer();

  const handlers = buildApiHandlers(container);

  const app = fastify({
    loggerInstance: logger,
    // Fastify owns the socket; 72s keeps the server quiet past typical
    // client/intermediary idle windows (~60s) so it is never the side that
    // hangs up first ("unexpected end of stream" on pooled okhttp clients).
    keepAliveTimeout: 72_000,
  });

  const envSchema = {
    type: 'object',
    required: ['PORT'],
    properties: {
      PORT: { type: 'string', default: process.env.APP_PORT || '3000' },
      NODE_ENV: {
        type: 'string',
        default: process.env.NODE_ENV || 'development',
      },
      HOST: { type: 'string', default: process.env.APP_HOST || '0.0.0.0' },
    },
  } as const;

  await app.register(env, {
    schema: envSchema,
    dotenv: true,
  });

  // Add common utilities
  await app.register(sensible);

  // Health endpoint
  app.get('/health', async (_request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: app.config.NODE_ENV,
      server: {
        protocol: 'http',
        port: app.config.PORT,
        hostname: app.config.HOST,
      },
      pid: process.pid,
      version: process.version,
    };
  });

  // Ready check endpoint
  app.get('/ready', async (_request, reply) => {
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  });

  // Info endpoint
  app.get('/info', async (_request, reply) => {
    return {
      name: 'My Playground API',
      version: '1.0.0',
      environment: app.config.NODE_ENV,
      endpoints: {
        health: '/health',
        ready: '/ready',
        docs: '/',
        spec: '/spec.json',
      },
    };
  });

  // Committed OpenAPI spec (D4) + Scalar docs on the same origin.
  app.get('/spec.json', async (_request, reply) => reply.send(spec));
  app.get('/', async (_request, reply) => {
    reply.type('text/html').send(SCALAR_DOCS_HTML);
  });

  // All 24 API routes, auth-hooked and table-driven. The scoped plugin keeps
  // the auth hook + access log off the health/docs endpoints.
  await app.register(async (api) => {
    // The API access log in CloudWatch (the previous transport needed a raw
    // access log in CloudWatch: request counts, latency, distinct users.
    api.addHook('onResponse', async (request, reply) => {
      const log = {
        method: request.method,
        url: request.url,
        status: reply.statusCode,
        durationMs: reply.elapsedTime.toFixed(0),
        userId: request.user?.id,
      };
      if (reply.statusCode >= 500) api.log.error(log, 'request');
      else api.log.info(log, 'request');
    });
    registerApiRoutes(api, handlers, makeAuthHookDeps());
  });

  // Error handler
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    app.log.error(error);

    const statusCode = error.statusCode || 500;
    const response = {
      error: {
        message: error.message || 'Internal Server Error',
        statusCode,
        timestamp: new Date().toISOString(),
      },
    };

    if (app.config.NODE_ENV === 'development') {
      response.error.message = error.message;
      if (error.statusCode) response.error.statusCode = error.statusCode;
      response.error.timestamp = new Date().toISOString();
    }

    reply.status(statusCode).send(response);
  });

  // Not found handler
  app.setNotFoundHandler(async (request, reply) => {
    reply.status(404).send({
      error: {
        message: `Route ${request.method} ${request.url} not found`,
        statusCode: 404,
        timestamp: new Date().toISOString(),
      },
    });
  });

  return { app, container };
};
