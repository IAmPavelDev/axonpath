/**
 * E2E manual-mode smoke — runs on the dev stack, inside the docker network
 * (host bridge is unreliable). Exercises the MANUAL lesson flow:
 *   skill.create(MANUAL) → ACTIVE immediately, no init class
 *   → skill/classOptions PENDING → job → READY with 3 ranked candidates
 *   → skill/create-class(target) → GENERATING → class 0 built around the target
 *   → quiz submit → options re-armed (PENDING → READY), no automatic class
 *
 * Run from the repo root:
 *   docker compose -f docker-compose-dev.yaml exec \
 *     -e FB_KEY="$FB_KEY" backend \
 *     sh -c 'pnpm --filter @axon/backend exec tsx e2e-manual-mode.mts'
 *
 * FB_KEY must be the Firebase web API key (EXPO_PUBLIC_FIREBASE_API_KEY from
 * apps/mobile/.env). The script creates a throwaway account and deletes every
 * row it created.
 */
import type { PrismaClient } from './src/prisma/generated/index.js';

const API_KEY = process.env.FB_KEY ?? '';
const BACKEND = 'http://127.0.0.1:3001';
const TOPIC = 'Basic photography lighting';

if (!API_KEY) {
  console.error('FB_KEY missing');
  process.exit(1);
}

const email = `smoke-manual-${Date.now()}@axon-dev.test`;
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
/** oRPC wire protocol (this plugin version): POST bodies carry
 * `{ json: <input> }` and responses answer `{ json: <result> }`. GET-contract
 * procedures take plain query params. */
const unwrapEnvelope = (payload: unknown): Json => {
  if (payload !== null && typeof payload === 'object' && 'json' in payload) {
    const inner = (payload as Record<string, unknown>).json;
    if (inner !== null && typeof inner === 'object') {
      return inner as Json;
    }
  }
  return payload as Json;
};

const rpc = async (procedure: string, input: Json, token: string): Promise<Json> => {
  const post = await postJson(`${BACKEND}/rpc/${procedure}`, { json: input }, {
    authorization: `Bearer ${token}`,
  });
  if (post.status === 200) {
    return unwrapEnvelope(post.json);
  }
  const url = new URL(`${BACKEND}/rpc/${procedure}`);
  for (const [k, v] of Object.entries(input)) url.searchParams.set(k, String(v));
  const get = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const json = unwrapEnvelope(await get.json().catch(() => ({})));
  throw new Error(
    `${procedure} failed: POST ${post.status} ${JSON.stringify(post.json).slice(0, 240)} | GET ${get.status} ${JSON.stringify(json).slice(0, 240)}`,
  );
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const poll = async <T,>(
  label: string,
  timeoutMs: number,
  step: () => Promise<T | null>,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await step();
    if (value !== null) return value;
    await sleep(3000);
  }
  throw new Error(`${label}: timed out after ${timeoutMs}ms`);
};

const main = async () => {
  // 1. Throwaway Firebase account.
  const signUp = await postJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { email, password, returnSecureToken: true },
  );
  if (signUp.status !== 200) {
    console.log('SIGNUP_FAILED:', signUp.status, JSON.stringify(signUp.json).slice(0, 240));
    process.exit(1);
  }
  const token = signUp.json.idToken as string;
  console.log('SIGNUP_OK');

  // 2. MANUAL create → ACTIVE immediately, no class 0, no init generation.
  const created = await rpc('skill/create', { topic: TOPIC, mode: 'MANUAL' }, token);
  const skillId = created.id as number;
  console.log('CREATE_OK:', JSON.stringify(created));
  if (created.status !== 'ACTIVE') {
    throw new Error(`expected ACTIVE skill shell, got ${String(created.status)}`);
  }
  const skillAfterCreate = await rpc('skill/get', { id: skillId }, token);
  if (skillAfterCreate.mode !== 'MANUAL') {
    throw new Error(`expected MANUAL mode, got ${String(skillAfterCreate.mode)}`);
  }
  const classes0 = (await rpc('class/list', { skillId }, token)) as Json[];
  if (classes0.length !== 0) {
    throw new Error(`manual skill must start without classes, got ${classes0.length}`);
  }

  // 3. Options job: PENDING → READY with 3 ranked candidates.
  const ready = await poll('class-options READY', 240_000, async () => {
    const snapshot = await rpc('skill/classOptions', { id: skillId }, token);
    if (snapshot.state === 'FAILED') {
      throw new Error(`options generation FAILED: ${JSON.stringify(snapshot).slice(0, 240)}`);
    }
    if (snapshot.state === 'READY' && (snapshot.options as Json[]).length === 3) {
      return snapshot;
    }
    return null;
  });
  const options = ready.options as Array<{ rank: number; text: string }>;
  console.log(
    'OPTIONS_READY:',
    options.map((option) => `${option.rank}. ${option.text.slice(0, 80)}`).join(' | '),
  );
  const ranks = options.map((option) => option.rank).sort().join(',');
  if (ranks !== '1,2,3') throw new Error(`expected ranks 1,2,3 — got ${ranks}`);

  // 4. Choose path → GENERATING, options consumed, class 0 around the target.
  const target = options[0]!.text;
  await rpc('skill/createClass', { id: skillId, target }, token);
  const skillGenerating = await rpc('skill/get', { id: skillId }, token);
  if (skillGenerating.status !== 'GENERATING') {
    throw new Error(`expected GENERATING after create-class, got ${String(skillGenerating.status)}`);
  }
  const consumed = await rpc('skill/classOptions', { id: skillId }, token);
  if (consumed.state !== 'NONE' || (consumed.options as Json[]).length !== 0) {
    throw new Error(`options must be consumed, got ${JSON.stringify(consumed).slice(0, 200)}`);
  }
  console.log('CREATE_CLASS_OK: target accepted, options consumed');

  const lesson0 = await poll('class 0', 300_000, async () => {
    const skill = await rpc('skill/get', { id: skillId }, token);
    if (skill.status !== 'ACTIVE') return null;
    const classes = (await rpc('class/list', { skillId }, token)) as Json[];
    return classes.length === 1 ? (classes[0] as Json) : null;
  });
  const classId = lesson0.id as number;
  console.log('LESSON_OK:', lesson0.title);

  // 5. Submit the quiz → MANUAL trigger re-arms options, no auto class.
  const quiz = (await rpc('quiz/get', { classId }, token)) as Array<{
    id: number;
    type: string;
    choices?: string[];
  }>;
  if (!Array.isArray(quiz) || quiz.length === 0) throw new Error('no questions generated');
  const first = quiz[0]!;
  const answer = first.type === 'TRUE_FALSE' ? 'True' : (first.choices?.[0] as string) ?? 'A';
  await rpc(
    'quiz/submit',
    { classId, answers: [{ questionId: first.id, answer, timeSpentMs: 5000 }] },
    token,
  );
  console.log('SUBMIT_OK');

  const rearmed = await poll('re-armed options', 240_000, async () => {
    const snapshot = await rpc('skill/classOptions', { id: skillId }, token);
    if (snapshot.state === 'FAILED') {
      throw new Error(`options regeneration FAILED: ${JSON.stringify(snapshot).slice(0, 240)}`);
    }
    if (snapshot.state === 'READY' && (snapshot.options as Json[]).length === 3) {
      return snapshot;
    }
    return null;
  });
  console.log(
    'OPTIONS_REARMED:',
    (rearmed.options as Array<{ text: string }>)
      .map((option) => option.text.slice(0, 70))
      .join(' | '),
  );

  const classesAfter = (await rpc('class/list', { skillId }, token)) as Json[];
  if (classesAfter.length !== 1) {
    throw new Error(`manual skill must not auto-generate, got ${classesAfter.length} classes`);
  }

  // 6. Mode switch back to AUTOMATIC is accepted on an ACTIVE skill.
  const switched = await rpc('skill/setMode', { id: skillId, mode: 'AUTOMATIC' }, token);
  console.log('SETMODE_OK:', JSON.stringify(switched));

  // 7. Cleanup: every row this skill created, then the throwaway user.
  const { prisma } = (await import(
    './src/modules/platform/infrastructure/prisma.js'
  )) as { prisma: PrismaClient };
  const classIds = (
    await prisma.class.findMany({ where: { skillId }, select: { id: true } })
  ).map((c) => c.id);
  await prisma.vector.deleteMany({ where: { skillId } });
  await prisma.event.deleteMany({ where: { skillId } });
  await prisma.answer.deleteMany({ where: { question: { classId: { in: classIds } } } });
  await prisma.question.deleteMany({ where: { classId: { in: classIds } } });
  await prisma.nextClassOption.deleteMany({ where: { skillId } });
  await prisma.nextClassJob.deleteMany({ where: { skillId } });
  await prisma.class.deleteMany({ where: { skillId } });
  await prisma.skill.delete({ where: { id: skillId } });
  await prisma.user.delete({ where: { email } });
  await prisma.$disconnect();
  console.log('DB_CLEANUP_OK');

  const del = await postJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`,
    { idToken: token },
  );
  console.log('FIREBASE_DELETE:', del.status);
  console.log('SMOKE_PASS');
};

main().catch((error) => {
  console.error('SMOKE_FAIL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
