/**
 * Local repro of the Lambda POST-body chain: buildApp → handleRequest wrapped
 * in serverless-http, invoked with a handcrafted API Gateway v2 event.
 * Prints what the RPC layer actually received.
 */
import { createRequire } from 'node:module';

// Dummy credentials: boot requires them present, nothing AI is called here.
process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || 'dummy';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'dummy';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/axon';
process.env.QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'axon-9e88e';

// CJS interop: the backend package is CommonJS; require() reads
// module.exports directly (ESM named-import detection fails on it).
const require = createRequire(import.meta.url);
const { buildApp } = require('./src/app.js') as typeof import('./src/app.js');
const serverlessHttp = require('serverless-http') as typeof import('serverless-http');

const { handleRequest, app } = await buildApp();
await app.ready();
const fastifyRouting = (
  app as unknown as { routing: (req: any, res: any) => void }
).routing.bind(app);
const invoke = serverlessHttp((req: any, res: any) =>
  handleRequest(req, res, fastifyRouting),
);

let token = '';
try {
  token = require('node:fs').readFileSync('/tmp/fb-token', 'utf8').trim();
} catch {}

const event = {
  version: '2.0',
  routeKey: 'POST /rpc/skill/create',
  rawPath: '/rpc/skill/create',
  rawQueryString: '',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  },
  requestContext: { http: { method: 'POST', path: '/rpc/skill/create' } },
  body: '{"topic":"Local repro topic","mode":"MANUAL"}',
  isBase64Encoded: false,
};

const result = (await invoke(event as any, {} as any)) as any;
console.log('STATUS:', result.statusCode);
console.log('BODY:', String(result.body).slice(0, 300));
process.exit(0);
