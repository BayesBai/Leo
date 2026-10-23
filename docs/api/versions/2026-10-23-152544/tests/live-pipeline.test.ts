import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../server/pipeline.js';
import { buildDemoDrafts, buildStrategies } from '../server/policies.js';
import type { Brief, EvidenceBundle, Platform } from '../shared/types.js';

// All values below are deliberately fictional protocol fixtures, never a source for user output.
const product = { id: 'fixture-pc', name: '协议测试机型（虚构）', system: '测试系统', category: '测试', description: '', imageCount: 4 };
const now = new Date().toISOString();
const evidence: EvidenceBundle = {
  product, sourceMode: 'ima', retrievedAt: now, warnings: [],
  facts: [
    ['weight', '机身重量约 1.2 kg。'], ['screen', '屏幕尺寸为 14 英寸。'], ['memory', '内存配置选项：16 GB。'],
  ].map(([id, statement]) => ({ id, statement, quote: statement, sourceTitle: '虚构的协议测试夹具', retrievedAt: now, qualifiers: [], sourceMode: 'ima', status: 'supported' })),
  images: Array.from({ length: 4 }, (_, i) => ({ id: `i${i}`, productId: product.id, name: `fixture-${i}.png`, description: '测试画面', url: `/api/assets/fixture-${i}`, sourceTitle: '虚构图片索引', width: 100, height: 100, sourceMode: 'ima' })),
  sources: [{ id: 'test-source', title: '测试来源', retrievedAt: now, sourceMode: 'ima', text: 'TEST ONLY' }],
};
const brief: Brief = { productId: product.id, audience: '大学新生', scene: '开学购机', goal: '到店体验', buyingStage: '对比选择', platforms: ['xiaohongshu', 'wechat'], instructions: '', mode: 'live', knowledgeSource: 'ima' };

function sse(data: unknown) {
  const events = [
    { choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(data) }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

function setup() {
  const saved = { fetch: globalThis.fetch, key: process.env.LLM_API_KEY, base: process.env.LLM_BASE_URL };
  process.env.LLM_API_KEY = 'mock-only-key'; process.env.LLM_BASE_URL = 'https://mock.invalid';
  return () => {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = saved.base;
  };
}

test('mock live pipeline writes each platform separately and audits their actual source evidence', async () => {
  const restore = setup(); const calls: string[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const user: string = body.messages.find((message: { role: string }) => message.role === 'user').content; const system: string = body.messages.find((message: { role: string }) => message.role === 'system').content;
      if (system.includes('你担任内容策划')) { calls.push('strategy'); return sse({ strategies: buildStrategies(brief, evidence) }); }
      if (system.includes('你担任图文编辑')) {
        const task = JSON.parse(user.split('\n策略：')[0]).task as Brief;
        assert.equal(task.platforms.length, 1); calls.push(task.platforms[0]);
        return sse({ drafts: buildDemoDrafts(task, evidence, buildStrategies(task, evidence)) });
      }
      assert.ok(user.includes('虚构的协议测试夹具')); assert.ok(user.includes('TEST ONLY') === false);
      calls.push('review'); return sse({ summary: '模拟语义检查', issues: [] });
    };
    const result = await runPipeline(brief, undefined, { evidence });
    assert.deepEqual(calls, ['strategy', 'xiaohongshu', 'wechat', 'review']);
    assert.equal(result.review.reviewedBy, 'rules+model'); assert.equal(result.review.status, 'passed');
    assert.equal(result.drafts.length, 2); assert.equal(result.review.issues.filter(issue => issue.severity === 'error').length, 0);
  } finally { restore(); }
});

test('mock model repair edits the affected platform only and reruns independent review', async () => {
  const restore = setup(); const writers = new Map<Platform, number>(); let reviews = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const user: string = body.messages.find((message: { role: string }) => message.role === 'user').content; const system: string = body.messages.find((message: { role: string }) => message.role === 'system').content;
      if (system.includes('你担任内容策划')) return sse({ strategies: buildStrategies(brief, evidence) });
      if (system.includes('你担任图文编辑')) {
        const task = JSON.parse(user.split('\n策略：')[0]).task as Brief;
        const platform = task.platforms[0]; const count = (writers.get(platform) || 0) + 1; writers.set(platform, count);
        const drafts = buildDemoDrafts(task, evidence, buildStrategies(task, evidence));
        if (platform === 'xiaohongshu' && count === 1) drafts[0].blocks[0].text += '\n无依据价格：9999元。';
        return sse({ drafts });
      }
      reviews++;
      return sse({ summary: '模拟独立复核', issues: reviews === 1 ? [{ severity: 'error', category: 'fact', message: '无依据价格', suggestion: '删除价格', platform: 'xiaohongshu' }] : [] });
    };
    const result = await runPipeline(brief, undefined, { evidence });
    assert.equal(writers.get('xiaohongshu'), 2); assert.equal(writers.get('wechat'), 1); assert.equal(reviews, 2);
    assert.doesNotMatch(JSON.stringify(result.drafts), /9999/); assert.equal(result.review.status, 'passed');
    assert.ok(result.trace.some(entry => entry.step === 'repair'));
  } finally { restore(); }
});

test('a failed mock platform request cancels the sibling writer instead of leaving it running', async () => {
  const restore = setup(); let siblingCancelled = false;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const user: string = body.messages.find((message: { role: string }) => message.role === 'user').content; const system: string = body.messages.find((message: { role: string }) => message.role === 'system').content;
      if (system.includes('你担任内容策划')) return sse({ strategies: buildStrategies(brief, evidence) });
      const task = JSON.parse(user.split('\n策略：')[0]).task as Brief;
      if (task.platforms[0] === 'xiaohongshu') return new Response('', { status: 401 });
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { siblingCancelled = true; reject(init!.signal!.reason); }, { once: true });
      });
    };
    await assert.rejects(runPipeline(brief, undefined, { evidence }), /HTTP 401/);
    assert.equal(siblingCancelled, true);
  } finally { restore(); }
});
