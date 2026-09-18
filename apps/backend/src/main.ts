import fastify, { FastifyInstance } from 'fastify';
import { createServer } from 'node:http';
import { RPCHandler } from '@orpc/server/node';
import { CORSPlugin } from '@orpc/server/plugins';
import sensible from '@fastify/sensible';
import env from '@fastify/env';
import { buildRouters } from '@router/index.ts';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { experimental_ZodSmartCoercionPlugin as ZodSmartCoercionPlugin } from '@orpc/zod/zod4';
import { OpenAPIGenerator } from '@orpc/openapi';

// Wiring: container (repositories/use cases/jobs) → oRPC routers → RPC handler.
import { configureContainer } from './container.ts';
const container = configureContainer();

const routers = buildRouters(container);

const handler = new RPCHandler(routers, {
  plugins: [new CORSPlugin(), new ZodSmartCoercionPlugin()],
});

const openAPIGenerator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

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

const app: FastifyInstance = fastify({
  logger: true,
  serverFactory: (fastifyHandler) => {
    const server = createServer(async (req, res) => {
      try {
        // Handle RPC routes first
        const { matched: rpcMatched } = await handler.handle(req, res, {
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
    });

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

async function startServer() {
  try {
    // Load environment configuration
    await app.register(env, {
      schema: envSchema,
      dotenv: true,
    });

    // Add common utilities
    await app.register(sensible);

    // Health endpoint
    app.get('/health', async (request, reply) => {
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
    app.get('/ready', async (request, reply) => {
      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
      };
    });

    // Info endpoint
    app.get('/info', async (request, reply) => {
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

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      app.log.info(`Received ${signal}, shutting down gracefully`);

      try {
        await app.close();
        app.log.info('Server closed successfully');
        process.exit(0);
      } catch (error) {
        app.log.error('Error during shutdown: ' + error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Start server
    const address = await app.listen({
      port: parseInt(app.config.PORT, 10),
      host: app.config.HOST,
    });

    app.log.info(`Server running in ${app.config.NODE_ENV} mode`);
    app.log.info(`Server listening at ${address}`);
    app.log.info(`Health check: ${address}/health`);
    app.log.info(`Documentation: ${address}/`);
  } catch (err) {
    app.log.error('Failed to start server: ' + err);
    process.exit(1);
  }
}

startServer();
