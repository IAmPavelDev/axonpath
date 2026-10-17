/**
 * E2E adaptive-loop smoke (Phase 4) — runs on the dev stack, inside the
 * docker network (host bridge is unreliable). Exercises:
 *   skill.create(GENERATING) → init → skill ACTIVE → class 0 + quiz
 *   → quiz submit with a deliberate mistake → skill-next-class job
 *   → class 1 appears → AI_NEXT/AI_INITIAL vectors + CLASS_GENERATED audit
 *   → retake → class 2 (no dedup).
 *
 * Run from the repo root:
 *   docker compose -f docker-compose-dev.yaml exec \
 *     -e FB_KEY="$FB_KEY" backend \
 *     sh -c 'pnpm --filter @axon/backend exec tsx e2e-adaptive-loop.mts'
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

const email = `smoke-loop-${Date.now()}@axon-dev.test`;
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

/** oRPC RPC protocol: POST /rpc/<procedure> with the input as JSON body;
 * fall back to GET with search params for GET-contract procedures. */
const rpc = async (procedure: string, input: Json, token: string): Promise<unknown> => {
  const post = await postJson(`${BACKEND}/rpc/${procedure}`, input, {
    authorization: `Bearer ${token}`,
  });
  if (post.status === 200) return post.json;
  const url = new URL(`${BACKEND}/rpc/${procedure}`);
  for (const [k, v] of Object.entries(input)) url.searchParams.set(k, String(v));
  const get = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const json = (await get.json().catch(() => ({}))) as Json;
  if (get.status !== 200) {
    throw new Error(
      `${procedure} failed: POST ${post.status} ${JSON.stringify(post.json).slice(0, 240)} | GET ${get.status} ${JSON.stringify(json).slice(0, 240)}`,
    );
  }
  return json as Json;
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

// 2. skill.create with the learner prompt — status must come back GENERATING.
const created = (await rpc('skill/create', { prompt: TOPIC }, token)) as {
  id: number;
  status: string;
};
console.log('CREATE_OK:', JSON.stringify(created));
if (created.status !== 'GENERATING') {
  throw new Error(`expected GENERATING on create, got ${created.status}`);
}
const skillId = created.id;

try {
  // 3. Poll until the metadata stage flips the skill ACTIVE (title +
  //    description drafted, zero classes).
  await poll('skill ACTIVE', 180_000, async () => {
    const skill = (await rpc('skill/get', { id: skillId }, token)) as { status: string };
    return skill.status === 'ACTIVE' ? skill : null;
  });
  console.log('SKILL_ACTIVE_OK');

  // 3b. Acceptance: saving the draft arms the first-lesson job (the skill
  //     returns to GENERATING until lesson 0 lands).
  const edited = (await rpc(
    'skill/edit',
    { id: skillId, topic: 'SQL joins from scratch', description: 'Practice-oriented joins for everyday queries.' },
    token,
  )) as Json;
  if (edited.status !== 'GENERATING') {
    throw new Error(`expected GENERATING after acceptance edit, got ${String(edited.status)}`);
  }
  console.log('ACCEPT_OK');

  // 4. Poll until the first-lesson stage settles ACTIVE with class 0.
  await poll('first lesson ACTIVE', 300_000, async () => {
    const skill = (await rpc('skill/get', { id: skillId }, token)) as { status: string };
    if (skill.status !== 'ACTIVE') return null;
    const classList0 = (await rpc('class/list', { skillId }, token)) as Array<Json>;
    return classList0.length === 1 ? classList0 : null;
  });
  const classList0 = (await rpc('class/list', { skillId }, token)) as Array<Json>;
  const class0 = (await rpc('class/get', { id: classList0[0]!.id }, token)) as Json;
  if (class0.skillId !== skillId) throw new Error(`class.get skillId=${class0.skillId}, expected ${skillId}`);
  console.log('CLASS0_OK:', class0.id, 'skillId present');

  // 5. Quiz for class 0; first answer is a guaranteed-wrong garbage string.
  const quiz = (await rpc('quiz/get', { classId: class0.id }, token)) as Array<{
    id: number;
    choices: string[];
  }>;
  if (!Array.isArray(quiz) || quiz.length === 0) throw new Error('no questions generated');
  const wrongQuestion = quiz[0]!;
  const answers = quiz.map((q, i) => ({
    questionId: q.id,
    answer: i === 0 ? 'zzz-deliberately-wrong' : (q.choices[q.choices.length - 1] ?? 'zzz'),
  }));
  const submit1 = (await rpc(
    'quiz/submit',
    { classId: class0.id, answers },
    token,
  )) as { score: number; total: number };
  console.log('SUBMIT1_OK:', JSON.stringify(submit1));
  if (submit1.score >= submit1.total) throw new Error('expected at least one wrong answer');

  // 6. The adaptive loop: class 1 must appear without any client trigger.
  await poll('second class', 180_000, async () => {
    const list = (await rpc('class/list', { skillId }, token)) as Array<Json>;
    return list.length >= 2 ? list : null;
  });
  console.log('NEXT_CLASS_APPEARED');

  // 7. Memory + audit evidence straight from Postgres.
  const { prisma } = (await import(
    './src/modules/platform/infrastructure/prisma.js'
  )) as { prisma: PrismaClient };
  const vectors = await prisma.vector.findMany({
    where: { skillId },
    select: { source: true, classIndex: true, textSnippet: true },
    orderBy: [{ classIndex: 'asc' }, { source: 'asc' }],
  });
  console.log('VECTORS:', JSON.stringify(vectors));
  const hasSummaryAt1 = vectors.some((v) => v.source === 'AI_NEXT' && v.classIndex === 1);
  if (!hasSummaryAt1) throw new Error('no AI_NEXT summary vector for classIndex 1');

  const event = await prisma.event.findFirst({
    where: { skillId, type: 'CLASS_GENERATED' },
    orderBy: { id: 'desc' },
  });
  const payload = (event?.payload ?? {}) as { action?: string; prompt?: string; response?: string };
  console.log(
    'EVENT_CHECK:',
    'action=', payload.action,
    '| prompt mentions missed question:', payload.prompt?.includes(wrongQuestion ? 'zzz' : '') ?? false,
  );
  if (payload.action !== 'next_class') throw new Error('CLASS_GENERATED payload action mismatch');
  if (!payload.prompt?.includes('Lessons already covered')) {
    throw new Error('prompt lacks the AI_NEXT covered-lessons block');
  }

  const class1 = (await rpc('class/get', { id: (await (async () => {
    const list = (await rpc('class/list', { skillId }, token)) as Array<{ id: number }>;
    return list.find((c) => c.id !== class0.id)!;
  })()).id }, token)) as { id: number; title: string };
  console.log('CLASS1_OK:', class1.id, JSON.stringify(class1.title).slice(0, 80));

  // 8. Retake → a third class (D6: no dedup in beta, regeneration is expected).
  const submit2 = (await rpc(
    'quiz/submit',
    { classId: class0.id, answers },
    token,
  )) as Json;
  console.log('SUBMIT2_OK:', JSON.stringify(submit2).slice(0, 120));
  await poll('third class', 180_000, async () => {
    const list = (await rpc('class/list', { skillId }, token)) as Array<Json>;
    return list.length >= 3 ? list : null;
  });
  console.log('RETAKE_GENERATED_OK');

  // 9. Cleanup: every row this skill created, then the throwaway user.
  const classIds = (await prisma.class.findMany({ where: { skillId }, select: { id: true } })).map((c) => c.id);
  await prisma.vector.deleteMany({ where: { skillId } });
  await prisma.event.deleteMany({ where: { skillId } });
  await prisma.answer.deleteMany({ where: { question: { classId: { in: classIds } } } });
  await prisma.question.deleteMany({ where: { classId: { in: classIds } } });
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
} catch (error) {
  console.error('SMOKE_FAIL:', error instanceof Error ? error.message : error);
  process.exit(1);
}
