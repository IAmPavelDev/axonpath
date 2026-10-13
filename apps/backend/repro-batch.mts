/**
 * Lambda-path batch discriminator: buildApp → serverless-http with a real
 * API Gateway event, POSTing a well-formed oRPC batch envelope to
 * /rpc/skill/get/__batch__ with a garbage bearer token.
 *
 * - Adapter delivers the body  → batch envelope parses → per-item auth
 *   rejection → status 207.
 * - Adapter loses the body     → parseBatchRequest throws → status 400
 *   "Invalid batch request" in ~0 ms.
 *
 * Run: pnpm --filter @axon/backend exec tsx repro-batch.mts
 */
import { createRequire } from 'node:module';

process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || 'dummy';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/axon';
process.env.QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'axon-9e88e';

const require = createRequire(import.meta.url);
const { buildApp } = require('./src/app.js') as typeof import('./src/app.js');
const serverlessHttp = require('serverless-http') as typeof import('serverless-http');

const { handleRequest, app } = await buildApp();
await app.ready();
const routing = (app as unknown as { routing: (req: any, res: any) => void }).routing.bind(app);
const invoke = serverlessHttp((req: any, res: any) =>
  handleRequest(req, res, routing),
);

const batchBody = JSON.stringify([
  { url: 'http://localhost/rpc/skill/get', body: { json: { id: 20 } } },
  { url: 'http://localhost/rpc/skill/get', body: { json: { id: 19 } } },
]);

const events: Array<[string, Record<string, unknown>]> = [
  [
    'v2.0',
    {
      version: '2.0',
      routeKey: 'POST /rpc/skill/get/__batch__',
      rawPath: '/rpc/skill/get/__batch__',
      headers: {
        'content-type': 'application/json',
        'x-orpc-batch': 'buffered',
        authorization: 'Bearer garbage.token.here',
      },
      requestContext: { http: { method: 'POST', path: '/rpc/skill/get/__batch__' } },
      body: batchBody,
      isBase64Encoded: false,
    },
  ],
  [
    'v1.0',
    {
      version: '1.0',
      resource: '/rpc/skill/get/__batch__',
      httpMethod: 'POST',
      path: '/rpc/skill/get/__batch__',
      headers: {
        'Content-Type': 'application/json',
        'x-orpc-batch': 'buffered',
        authorization: 'Bearer garbage.token.here',
      },
      body: batchBody,
      isBase64Encoded: false,
    },
  ],
];

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve({ statusCode: 'TIMEOUT', body: 'invoke never settled' }) as T, ms)),
  ]);

for (const [label, event] of events) {
  const result = (await withTimeout(invoke(event as any, {} as any) as any, 8000)) as any;
  console.log(`[${label}] STATUS:`, result.statusCode);
  console.log(`[${label}] BODY:`, String(result.body).slice(0, 250));
}
process.exit(0);
