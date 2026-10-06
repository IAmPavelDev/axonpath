import fastify from 'fastify';
import type { FastifyServerFactoryHandler } from 'fastify';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RPCHandler } from '@orpc/server/node';
import { BatchHandlerPlugin, CORSPlugin } from '@orpc/server/plugins';
import sensible from '@fastify/sensible';
import env from '@fastify/env';
import { buildRouters } from '@router/index';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { experimental_ZodSmartCoercionPlugin as ZodSmartCoercionPlugin } from '@orpc/zod/zod4';
import { OpenAPIGenerator } from '@orpc/openapi';

// Wiring: container (repositories/use cases/jobs) → oRPC routers → RPC handler.
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

/**
 * Build the whole app exactly once, shared by both entrypoints:
 * - main.ts: `app.listen` on the container (long-lived server, EC2 today).
 * - lambda-api.ts: no listen; `handleRequest` is wrapped by serverless-http
 *   with Fastify's router as the fallback handler.
 */
export const buildApp = async () => {
  const container = configureContainer();

  const routers = buildRouters(container);

  const rpc = new RPCHandler(routers, {
    plugins: [
      new CORSPlugin(),
      new ZodSmartCoercionPlugin(),
      // Mobile fires a screen's parallel queries in one tick; the batch plugin
      // collapses them into a single HTTP round trip. Buffered mode:
      // serverless-http / API Gateway cannot stream a batch response body.
      new BatchHandlerPlugin(),
    ],
  });

  const openAPIGenerator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  /**
   * The one raw-Node request path. RPC routes bypass Fastify's router
   * (oRPC handles req/res directly); the OpenAPI spec and docs endpoints are
   * served here too; everything else falls through to Fastify.
   */
  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    fastifyHandler: FastifyServerFactoryHandler,
  ): Promise<void> => {
    try {
      // Handle RPC routes first
      const { matched: rpcMatched } = await rpc.handle(req, res, {
        context: { headers: req.headers },
        prefix: '/rpc',
      });

      if (rpcMatched) {
        return;
      }

      // Handle OpenAPI spec endpoint
      if (req.url === '/spec.json') {
        try {
          const spec = await openAPIGenerator.generate(routers, {
            info: {
              title: 'My Playground',
              version: '1.0.0',
            },
            servers: [{ url: '/rpc' }],
            security: [{ bearerAuth: [] }],
            components: {
              securitySchemes: {
                bearerAuth: {
                  type: 'http',
                  scheme: 'bearer',
                },
              },
            },
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(spec));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: 'Failed to generate OpenAPI spec' }),
          );
          return;
        }
      }

      // For root path, serve documentation
      if (req.url === '/') {
        const html = `
          <!doctype html>
          <html>
            <head>
              <title>My Client</title>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <link rel="icon" type="image/svg+xml" href="https://orpc.unnoq.com/icon.svg" />
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

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      // Let Fastify handle all other routes (including /health)
      fastifyHandler(req, res);
    } catch (error) {
      console.error('Server factory error:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  };

  const app = fastify({
    logger: true,
    serverFactory: (fastifyHandler) => {
      const server = createServer(
        {
          // Node's default keepAliveTimeout is 5s: the server closes an idle
          // pooled keep-alive connection right as the client (mobile okhttp)
          // reuses it → "unexpected end of stream". 72s keeps the server quiet
          // well past typical client/intermediary idle windows (~60s), so it is
          // never the side that hangs up first. Fastify's own keepAliveTimeout
          // option cannot apply: the socket is created here, not by Fastify.
          keepAliveTimeout: 72_000,
        },
        async (req, res) => {
          await handleRequest(req, res, fastifyHandler);
        },
      );

      return server;
    },
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
        rpc: '/rpc/*',
      },
    };
  });

  // Error handler
  app.setErrorHandler(async (error, request, reply) => {
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

  return { app, container, handleRequest };
};
