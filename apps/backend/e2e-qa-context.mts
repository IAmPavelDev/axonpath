/**
 * E2E QA-context smoke (Phase 8) — runs on the dev stack, inside the docker
 * network. Exercises the full layered-QA pipeline against the REAL Postgres,
 * Qdrant and AI endpoints, speaking the exact same oRPC protocol as the
 * mobile app (real RPCLink + @axon/api-contract client):
 *   skill.create → init (auto-runs CLASS_CONTENT_VECTORS_JOB) → class 0
 *   → class.qa.ask with a verbatim selection → layered answer (real QA call)
 *   → CONTENT_CHUNK vectors + QA_DERIVED mining + QA_ANSWERED audit
 *   → a real skill-scoped retrieval round-trip through Qdrant.
 *
 * Run from the repo root:
 *   docker compose -f docker-compose-dev.yaml exec \
 *     -e FB_KEY="$FB_KEY" backend \
 *     sh -c 'pnpm --filter @axon/backend exec tsx e2e-qa-context.mts'
 *
 * FB_KEY must be the Firebase web API key (EXPO_PUBLIC_FIREBASE_API_KEY from
 * apps/mobile/.env). The script creates a throwaway account and deletes every
 * row it created.
 */
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { AppContract } from '@axon/api-contract';
import type { PrismaClient } from './src/prisma/generated/index.js';

const API_KEY = process.env.FB_KEY ?? '';
const BACKEND = 'http://127.0.0.1:3001';
const TOPIC = 'Basic photography exposure';

if (!API_KEY) {
  console.error('FB_KEY missing');
  process.exit(1);
}

const email = `smoke-qa-${Date.now()}@axon-dev.test`;
const password = `Sf${Math.random().toString(36).slice(2)}!9xQz`;

const postJson = async (url: string, body: Record<string, unknown>) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
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

// The oRPC client: identical protocol + auth injection to the mobile app.
let bearer = '';
const client: ContractRouterClient<AppContract> = createORPCClient(
  new RPCLink({
    url: `${BACKEND}/rpc`,
    headers: async () => (bearer ? { authorization: `Bearer ${bearer}` } : {}),
  }),
);

// 1. Throwaway Firebase account.
const signUp = await postJson(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  { email, password, returnSecureToken: true },
);
if (signUp.status !== 200) {
  console.log('SIGNUP_FAILED:', signUp.status, JSON.stringify(signUp.json).slice(0, 240));
  process.exit(1);
}
bearer = signUp.json.idToken as string;
console.log('SIGNUP_OK');

const created = await client.skill.create({ topic: TOPIC });
console.log('CREATE_OK:', JSON.stringify(created));
const skillId = created.id;

const cleanup = async (prisma: PrismaClient) => {
  const classIds = (await prisma.class.findMany({ where: { skillId }, select: { id: true } })).map((c) => c.id);
  await prisma.vector.deleteMany({ where: { skillId } });
  await prisma.event.deleteMany({ where: { skillId } });
  await prisma.classQaBlock.deleteMany({ where: { classId: { in: classIds } } });
  await prisma.answer.deleteMany({ where: { question: { classId: { in: classIds } } } });
  await prisma.question.deleteMany({ where: { classId: { in: classIds } } });
  await prisma.class.deleteMany({ where: { skillId } });
  await prisma.skill.delete({ where: { id: skillId } });
  await prisma.user.delete({ where: { email } });
  await prisma.$disconnect();
};

try {
  // 2. Poll until init flips the skill ACTIVE (its boot also vectorizes the
  //    class conspect into CONTENT_CHUNK vectors via the background job).
  await poll('skill ACTIVE', 180_000, async () => {
    const skill = await client.skill.get({ id: skillId });
    return skill.status === 'ACTIVE' ? skill : null;
  });
  console.log('SKILL_ACTIVE_OK');

  const classList = await client.class.list({ skillId });
  const class0 = await client.class.get({ id: classList[0]!.id });
  console.log('CLASS0_OK:', class0.id);

  // 3. Ask with a verbatim selection taken from the real lesson content.
  const firstLine = class0.contentMd.split('\n').find((line) => line.trim().length > 0) ?? '';
  const anchorText = firstLine.replace(/^#+\s*/, '').slice(0, 80);
  const question = 'Summarize this passage in one sentence.';
  const asked = await client.class.qa.ask({
    classId: class0.id,
    anchorParagraph: 0,
    anchorText,
    question,
  });
  if (asked.status !== 'PENDING') throw new Error(`expected PENDING, got ${asked.status}`);
  console.log('ASK_OK:', asked.blockId);

  // 4. The layered answer arrives asynchronously (real QA generation).
  const answered = await poll('QA ANSWERED', 240_000, async () => {
    const blocks = await client.class.qa.list({ classId: class0.id });
    const block = blocks.find((b) => b.id === asked.blockId);
    return block && block.status === 'ANSWERED' ? block : null;
  });
  if (!answered.answer || answered.answer.length < 20) {
    throw new Error('answer missing or suspiciously short');
  }
  if (answered.anchorText !== anchorText) {
    throw new Error(`stored anchorText mismatch: ${JSON.stringify(answered.anchorText)}`);
  }
  console.log('ANSWER_OK:', JSON.stringify(answered.answer.slice(0, 100)));

  // 5. Evidence straight from Postgres: chunk vectors, QA mining, audit.
  const { prisma } = (await import(
    './src/modules/platform/infrastructure/prisma.js'
  )) as { prisma: PrismaClient };

  await poll('CONTENT_CHUNK vectors', 60_000, async () => {
    const rows = await prisma.vector.count({
      where: { skillId, source: 'CONTENT_CHUNK' },
    });
    return rows > 0 ? rows : null;
  });
  const chunks = await prisma.vector.findMany({
    where: { skillId, source: 'CONTENT_CHUNK' },
    select: { classId: true, classIndex: true, textSnippet: true },
  });
  console.log('CONTENT_CHUNK_OK:', chunks.length, 'chunks');
  if (!chunks.some((c) => c.classId === class0.id)) {
    throw new Error('CONTENT_CHUNK vectors not attached to the asked class');
  }

  await poll('QA_DERIVED vector', 60_000, async () => {
    const rows = await prisma.vector.findFirst({
      where: { skillId, source: 'QA_DERIVED', qaBlockId: asked.blockId },
    });
    return rows ?? null;
  });
  console.log('QA_DERIVED_OK: mined with qaBlockId', asked.blockId);

  const qaEvent = await prisma.event.findFirst({
    where: { skillId, type: 'QA_ANSWERED' },
    orderBy: { id: 'desc' },
  });
  const payload = (qaEvent?.payload ?? {}) as { prompt?: string; system?: string };
  const prompt = payload.prompt ?? '';
  console.log(
    'EVENT_CHECK:',
    '| document model:', prompt.includes('Document model:'),
    '| verbatim quote:', prompt.includes(`"""${anchorText}"""`),
    '| learner typed:', prompt.includes('The learner typed:'),
    '| lesson authored:', prompt.includes('Lesson content (markdown), written by Axon:'),
    '| attribution persona:', payload.system?.includes('Attribution: every text you receive carries an author label.') ?? false,
  );
  if (!prompt.includes('Document model:')) throw new Error('prompt lacks the document-model preamble');
  if (!prompt.includes(`"""${anchorText}"""`)) throw new Error('prompt lacks the verbatim L1 quote');
  if (!prompt.includes('The learner typed:')) throw new Error('prompt lacks the attribution label');
  if (!prompt.includes('Lesson content (markdown), written by Axon:')) {
    throw new Error('prompt lacks the authored-lesson label');
  }

  // 6. Real retrieval round-trip: the asked class's chunks must surface
  //    through the skill-scoped Qdrant filter with a live embedding query.
  const { makeZaiAi } = await import('./src/modules/tutoring/infrastructure/zai.client.js');
  const { makeVectorStoreAdapter } = await import(
    './src/modules/memory/infrastructure/vector.metadata.repo.js'
  );
  const { makeRetrieveQaContext } = await import(
    './src/modules/memory/application/retrieve-qa-context.js'
  );
  const retrieveQaContext = makeRetrieveQaContext({
    ai: makeZaiAi(),
    vectorStore: makeVectorStoreAdapter(),
  });
  const hits = await retrieveQaContext({
    userId: (await prisma.skill.findUniqueOrThrow({ where: { id: skillId } })).userId,
    skillId,
    query: `${question}\n${anchorText}`,
  });
  console.log('RETRIEVAL_OK: skillHits=', hits.skillHits.length, 'crossHits=', hits.crossHits.length);
  if (hits.skillHits.length === 0) throw new Error('skill-scoped retrieval returned no hits');

  // 7. Cleanup: every row this skill created, then the throwaway user.
  await cleanup(prisma);
  console.log('DB_CLEANUP_OK');

  const del = await postJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`,
    { idToken: bearer },
  );
  console.log('FIREBASE_DELETE:', del.status);
  console.log('SMOKE_PASS');
} catch (error) {
  console.error('SMOKE_FAIL:', error instanceof Error ? error.message : error);
  // Best-effort cleanup of a half-created skill so reruns start clean.
  try {
    const { prisma } = (await import(
      './src/modules/platform/infrastructure/prisma.js'
    )) as { prisma: PrismaClient };
    await cleanup(prisma);
  } catch {
    // cleanup on failure is best-effort only
  }
  process.exit(1);
}
