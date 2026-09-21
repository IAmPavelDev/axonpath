/**
 * E2E auth probe — runs inside the docker network (host bridge is broken).
 * 1. Creates a throwaway Firebase account via the Identity Toolkit REST API.
 * 2. Sends its real ID token to our backend /rpc/auth/me.
 * 3. Prints the provisioned DB row, then deletes the account + row.
 */
const API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY!;
const BACKEND = 'http://127.0.0.1:3001';

const email = `smoke-${Date.now()}@axon-dev.test`;
const password = `Sf${Math.random().toString(36).slice(2)}!9xQz`;

type Json = Record<string, unknown>;
const postJson = async (url: string, body: Json, headers: Json = {}) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
};

const signUp = await postJson(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  { email, password, returnSecureToken: true },
);
if (signUp.status !== 200) {
  console.log('SIGNUP_FAILED:', signUp.status, JSON.stringify(signUp.json).slice(0, 300));
  process.exit(1);
}
const idToken = signUp.json.idToken as string;
console.log('SIGNUP_OK uid=', signUp.json.localId);

// GET contract procedure — try GET first (RPCLink style), fall back to POST.
const meGet = await fetch(`${BACKEND}/rpc/auth/me`, {
  headers: { authorization: `Bearer ${idToken}` },
});
let me = { status: meGet.status, json: (await meGet.json().catch(() => ({}))) as Json };
if (me.status !== 200) {
  me = await postJson(`${BACKEND}/rpc/auth/me`, {}, { authorization: `Bearer ${idToken}` });
}
console.log('ME_RESULT:', me.status, JSON.stringify(me.json).slice(0, 400));

// No-token request must stay 401 while a valid token works.
const anon = await postJson(`${BACKEND}/rpc/auth/me`, {});
console.log('ANON_RESULT:', anon.status, JSON.stringify(anon.json).slice(0, 160));

// Cleanup: delete the Firebase account and the provisioned DB row.
const del = await postJson(
  `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`,
  { idToken },
);
console.log('FIREBASE_DELETE:', del.status);

const { prisma } = await import('./src/modules/platform/infrastructure/prisma');
const row = await prisma.user.findUnique({ where: { email } });
console.log('DB_ROW_BEFORE_CLEANUP:', JSON.stringify(row, null, 0)?.slice(0, 300));
if (row) await prisma.user.delete({ where: { id: row.id } });
const after = await prisma.user.findUnique({ where: { email } });
console.log('CLEANUP_OK:', after === null);
await prisma.$disconnect();
