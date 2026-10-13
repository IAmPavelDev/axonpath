const serverlessHttp = require('serverless-http');
const { RPCHandler } = require('@orpc/server/node');
const { BatchHandlerPlugin, CORSPlugin } = require('@orpc/server/plugins');

const handler = new RPCHandler(
  { echo: async (input) => input },
  { plugins: [new BatchHandlerPlugin(), new CORSPlugin()] },
);

const invoke = serverlessHttp((req, res) =>
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

(async () => {
  const result = await invoke(event, {});
  console.log('STATUS:', result.statusCode);
  console.log('BODY:', String(result.body).slice(0, 200));
  process.exit(0);
})();
