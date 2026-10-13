/**
 * Minimal serverless-http + oRPC discriminator: a single echo procedure with
 * the same plugins the app uses, no auth, no fastify. If the echoed input
 * comes back, this stack parses bodies fine on this machine; if not, the
 * body-loss is reproduced without the app.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RPCHandler } = require('@orpc/server/node');
const { BatchHandlerPlugin, CORSPlugin } = require('@orpc/server/plugins');
const { ORPCError } = require('@orpc/server');
const serverlessHttp = require('serverless-http') as typeof import('serverless-http');

const handler = new RPCHandler(
  {
    echo: async (input: unknown) => input,
  },
  { plugins: [new BatchHandlerPlugin(), new CORSPlugin()] },
);

const invoke = serverlessHttp((req: any, res: any) =>
  handler.handle(req, res, { prefix: '/rpc' }),
);

const event = {
  version: '2.0',
  routeKey: 'POST /rpc/echo',
  rawPath: '/rpc/echo',
  rawQueryString: '',
  headers: { 'content-type': 'application/json' },
  requestContext: { http: { method: 'POST', path: '/rpc/echo' } },
  body: '{"json":{"hello":"world"}}',
  isBase64Encoded: false,
};

const result = (await invoke(event as any, {} as any)) as any;
console.log('STATUS:', result.statusCode);
console.log('BODY:', String(result.body).slice(0, 200));
process.exit(0);
