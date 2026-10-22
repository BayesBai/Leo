import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import type { Brief, EvidenceBundle, OutlineResult, Platform, RunResult } from '../shared/types.js';
import { createOutline, confirmedOutline, confirmOutline, getOutline, publicOutline, reviseOutline, saveOutline, WorkflowError } from '../server/outlines.js';
import { runPipeline } from '../server/pipeline.js';
import { buildDemoDrafts, buildStrategies } from '../server/policies.js';
import { getRenderAsset, renderRun, validateRender } from '../server/render/index.js';
import { renderSatori } from '../server/render/layouts.js';
import { createApp } from '../server/index.js';
import { updateConnections } from '../server/connections.js';
import { renderRequestSchema, outlineEditSchema } from '../server/schemas.js';
import { listProducts } from '../server/knowledge.js';
import { DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME } from '../server/model.js';

const product = { id: 'test-only-pc', name: '模拟测试机型', system: '测试系统', category: '测试', description: '纯协议测试', imageCount: 4 };
const now = new Date().toISOString();
const evidence: EvidenceBundle = { product, sourceMode: 'local', retrievedAt: now, warnings: ['纯模拟测试'], sources: [{ id: 'doc-test', title: '模拟来源', text: '禁止回传的原始全文', retrievedAt: now, sourceMode: 'local' }],
  facts: [['fact-weight', '机身重量约 1.2 kg。'], ['fact-screen', '屏幕尺寸为 14 英寸。'], ['fact-memory', '内存容量为 16 GB。']].map(([id, statement]) => ({ id, statement, quote: statement, qualifiers: ['以实际配置为准'], sourceTitle: '模拟来源', sourceMode: 'local', retrievedAt: now, status: 'supported' })),
  images: Array.from({ length: 4 }, (_, i) => ({ id: `image-${i}`, productId: product.id, name: `模拟素材${i}.png`, description: '模拟图', url: `/api/assets/test-image-${i}`, width: 20, height: 20, sourceMode: 'local', sourceTitle: '模拟图索引' })),
};
const brief: Brief = { productId: product.id, audience: '家长', scene: '开学季', goal: '到店体验', buyingStage: '对比选择', platforms: ['moments'], mode: 'demo', knowledgeSource: 'local', instructions: '' };
const make = () => createOutline(brief, undefined, { evidence: structuredClone(evidence) });
const status = (code: number) => (error: unknown) => error instanceof Error && 'status' in error && error.status === code;
function mockRun(platform: Platform = 'moments'): RunResult {
  const task = { ...brief, platforms: [platform] }; const strategies = buildStrategies(task, evidence);
  return { id: 'run-test', createdAt: now, brief: task, product, evidence: structuredClone(evidence), strategies, drafts: buildDemoDrafts(task, evidence, strategies), review: { status: 'needs_attention', issues: [], factCount: 3, citedFactCount: 2, imageCount: 2, checks: [], reviewedBy: 'rules' }, trace: [], revision: 1, notice: '模拟测试' };
}

test('outline version gate rejects unconfirmed, stale and edited confirmations; snapshot stays immutable', async () => {
  const original = await make(); assert.throws(() => confirmedOutline(original.id, 1), status(409));
  confirmOutline(original.id, 1); const snapshot = confirmedOutline(original.id, 1);
  const edits = structuredClone(original.platforms); edits[0].title = '家长的购机参考'; edits[0].sections.reverse();
  const next = saveOutline(original.id, 1, edits); assert.equal(next.version, 2); assert.equal(next.status, 'editing');
  assert.throws(() => confirmOutline(original.id, 1), status(409)); assert.throws(() => confirmedOutline(original.id, 2), status(409));
  assert.notEqual(snapshot.platforms[0].title, next.platforms[0].title); assert.equal(snapshot.status, 'confirmed');
  assert.equal(publicOutline(next).evidence.sources[0].text, undefined);
  confirmOutline(original.id, 2);
  const result = await runPipeline(brief, undefined, { outline: confirmedOutline(original.id, 2), evidence: next.evidence });
  assert.deepEqual(result.outline, { id: original.id, version: 2 }); assert.equal(result.drafts[0].titles[0], edits[0].title);
  assert.deepEqual(result.drafts[0].blocks.map(b => b.heading), edits[0].sections.map(s => s.heading));
});
test('outline validates platform set, unique sections, supported references and exact-model images', async () => {
  const outline = await make();
  const bad = structuredClone(outline.platforms); bad[0].sections[0].factIds = ['nonexistent']; assert.throws(() => saveOutline(outline.id, 1, bad), status(400));
  const duplicate = structuredClone(outline.platforms); duplicate[0].imageIds = ['image-0', 'image-0']; assert.throws(() => saveOutline(outline.id, 1, duplicate), status(400));
  const platform = structuredClone(outline.platforms); platform[0].platform = 'wechat'; assert.throws(() => saveOutline(outline.id, 1, platform), status(400));
  assert.equal(getOutline(outline.id).version, 1); assert.throws(() => getOutline('missing'), status(410));
  outlineEditSchema.parse({ version: 1, platforms: outline.platforms });
});
test('outline image bounds are enforced before model work and before saving or confirming', async () => {
  const old = { fetch: globalThis.fetch, key: process.env.LLM_API_KEY }; let calls = 0;
  process.env.LLM_API_KEY = 'mock-only-image-preflight';
  globalThis.fetch = async () => { calls++; throw new Error('不应调用模型'); };
  try {
    const sparse = { ...structuredClone(evidence), images: evidence.images.slice(0, 2) };
    await assert.rejects(createOutline({ ...brief, mode: 'live', platforms: ['xiaohongshu'] }, undefined, { evidence: sparse }), (error: any) => error.status === 422);
    await assert.rejects(runPipeline({ ...brief, mode: 'live', platforms: ['xiaohongshu'] }, undefined, { evidence: sparse }), (error: any) => error.status === 422);
    assert.equal(calls, 0);
    const outline = await make(); const edits = structuredClone(outline.platforms); edits[0].imageIds = [];
    assert.throws(() => saveOutline(outline.id, 1, edits), (error: any) => error.status === 422);
    assert.equal(getOutline(outline.id).version, 1);
    assert.equal(confirmOutline(outline.id, 1).status, 'confirmed');
  } finally { globalThis.fetch = old.fetch; if (old.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = old.key; }
});
test('model outline selection errors receive one correction attempt inside structured validation', async () => {
  const base = await make(); const old = { fetch: globalThis.fetch, key: process.env.LLM_API_KEY }; let calls = 0;
  process.env.LLM_API_KEY = 'mock-only-outline-correction';
  globalThis.fetch = async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    const user = body.messages.find((message: { role: string }) => message.role === 'user').content;
    if (calls === 2) assert.match(user, /上一次输出格式不符合要求/);
    const platforms = structuredClone(base.platforms); if (calls === 1) platforms[0].imageIds = [];
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ platforms }) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const outline = await createOutline({ ...brief, mode: 'live' }, undefined, { evidence });
    assert.equal(calls, 2); assert.deepEqual(outline.platforms[0].imageIds, base.platforms[0].imageIds);
  } finally { globalThis.fetch = old.fetch; if (old.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = old.key; }
});
test('outline cancellation never commits a new version; demo AI edits are explicit and revoke approval', async () => {
  const outline = await make(); confirmOutline(outline.id, 1);
  await assert.rejects(reviseOutline(outline.id, 1, '伪造一次亲测'), status(422)); assert.equal(getOutline(outline.id).version, 1);
  const controller = new AbortController(); controller.abort(); await assert.rejects(reviseOutline(outline.id, 1, '精简', controller.signal));
  const next = await reviseOutline(outline.id, 1, '精简'); assert.equal(next.version, 2); assert.equal(next.status, 'editing');
});
test('render rejects arbitrary HTML/URL/path inputs, wrong versions, invalid titles and missing/duplicate photos', () => {
  const run = mockRun(); const request = { runId: run.id, revision: 1, platform: 'moments' as const, selectedTitleIndex: 0, templateId: 'moments-square' };
  assert.equal(renderRequestSchema.safeParse({ ...request, html: '<script>bad</script>' }).success, false);
  assert.throws(() => validateRender(run, { ...request, revision: 2 }), status(409));
  assert.throws(() => validateRender(run, { ...request, selectedTitleIndex: 99 }), status(400));
  assert.throws(() => validateRender(run, { ...request, templateId: '../../.env.local' }), status(400));
  run.drafts[0].images = []; assert.throws(() => validateRender(run, request), status(422));
  run.drafts[0].images = [{ imageId: 'image-0', afterBlock: -1, caption: '', reason: '' }, { imageId: 'image-0', afterBlock: 0, caption: '', reason: '' }]; assert.throws(() => validateRender(run, request), status(422));
});
test('Satori produces actual Chinese PNG and rejects overflowing text without truncation', async () => {
  const template = { id: 'moments-square', name: '测试模板', platform: 'moments' as const, width: 1080, height: 1080 };
  const input = { heading: '中文排版 · 约有条件', text: '产品能力以资料支持和适用条件为准。', images: [], factIds: [], role: 'card' as const };
  const png = await renderSatori(input, template, '纯模拟 · 待确认', '模拟机型'); const meta = await sharp(png).metadata();
  assert.equal(meta.format, 'png'); assert.equal(meta.width, 1080); assert.equal(meta.height, 1080); assert.ok(png.length > 10000);
  await assert.rejects(renderSatori({ ...input, text: '不得删除的必要限定条件。'.repeat(1000) }, template, '预览', '模拟机型'), status(422));
});
test('runtime connection input is atomic, retains blank secrets and restricts endpoint hosts', () => {
  const saved = process.env.LLM_MODEL; const key = process.env.LLM_API_KEY;
  try {
    assert.throws(() => updateConnections({ baseUrl: 'https://127.0.0.1/', model: 'should-not-save' }), status(400)); assert.equal(process.env.LLM_MODEL, saved);
    updateConnections({ apiKey: '' }); assert.equal(process.env.LLM_API_KEY, key);
  } finally { if (saved === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = saved; }
});
test('live outline writer and repair cannot overwrite approved structure, references or product images', async () => {
  const original = await make(); confirmOutline(original.id, 1); const approved = confirmedOutline(original.id, 1);
  const old = { fetch: globalThis.fetch, key: process.env.LLM_API_KEY }; let writes = 0; let reviews = 0;
  process.env.LLM_API_KEY = 'mock-model-key-only';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const system: string = body.messages.find((message: { role: string }) => message.role === 'system').content; let output;
    if (system.includes('你根据用户已经确认的大纲展开正文')) {
      writes++;
      output = { title: '未经批准的标题', intro: '先从自己的选购任务出发。', blocks: [...approved.platforms[0].sections].reverse().map((s, i) => ({ id: s.id, heading: '未经批准的小标题', factIds: ['invented'], text: writes === 1 && i === 0 ? '重量999 kg。' : evidence.facts.find(f => s.factIds.includes(f.id))?.statement || '请到店核对自己的使用任务。' })), cta: '欢迎到店核对配置。', tags: [] };
    } else { reviews++; output = { summary: '模拟独立核验', issues: [] }; }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await runPipeline({ ...brief, mode: 'live' }, undefined, { outline: approved, evidence: approved.evidence });
    assert.equal(writes, 2); assert.equal(reviews, 2); assert.equal(result.review.reviewedBy, 'rules+model');
    assert.equal(result.drafts[0].titles[0], approved.platforms[0].title);
    assert.deepEqual(result.drafts[0].blocks.map(b => ({ id: b.id, heading: b.heading, factIds: b.factIds })), approved.platforms[0].sections.map(s => ({ id: s.id, heading: s.heading, factIds: s.factIds })));
    assert.deepEqual(result.drafts[0].images.map(i => i.imageId), approved.platforms[0].imageIds);
    assert.doesNotMatch(JSON.stringify(result.drafts), /未经批准|invented|999/);
  } finally { globalThis.fetch = old.fetch; if (old.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = old.key; }
});
test('outline, AI edit, writing, repair and review use the same default relay and model', async () => {
  const base = await make();
  const old = { fetch: globalThis.fetch, key: process.env.LLM_API_KEY, base: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL };
  const stages: string[] = []; let writes = 0; let reviews = 0;
  let approved: OutlineResult;
  process.env.LLM_API_KEY = 'mock-only-five-stage-key'; delete process.env.LLM_BASE_URL; delete process.env.LLM_MODEL;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `${DEFAULT_MODEL_BASE_URL}/chat/completions`);
    assert.equal(String(url), 'https://relay.nccnxta.cn/v1/chat/completions');
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer mock-only-five-stage-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, DEFAULT_MODEL_NAME); assert.equal(body.model, 'gemini-4-argon'); assert.equal(body.stream, true);
    const system: string = body.messages.find((message: { role: string }) => message.role === 'system').content;
    const user: string = body.messages.find((message: { role: string }) => message.role === 'user').content;
    let output;
    if (system.includes('你现在只策划可编辑大纲')) {
      const task = JSON.parse(user); stages.push(task.modification ? 'AI edit' : 'outline');
      assert.equal(body.max_tokens, 6500);
      const platforms = structuredClone(base.platforms);
      if (task.modification) platforms[0].title = '先聊聊开学选机的任务';
      output = { platforms };
    } else if (system.includes('你根据用户已经确认的大纲展开正文')) {
      writes++; stages.push(writes === 1 ? 'writing' : 'repair'); assert.equal(body.max_tokens, 3500);
      if (writes === 2) assert.match(user, /仅修复这些审核问题/);
      output = { intro: base.platforms[0].intro, blocks: approved.platforms[0].sections.map(section => ({ id: section.id, text: section.points.join('\n') })), cta: base.platforms[0].cta, tags: [] };
    } else {
      reviews++; stages.push('review'); assert.equal(body.max_tokens, 3000);
      output = { summary: '纯模拟定向审稿', issues: reviews === 1 ? [{ severity: 'error', category: 'fact', target: 'body', platform: 'moments', blockId: approved.platforms[0].sections[0].id, message: '需复核正文措辞', suggestion: '保留来源支持的事实并核对适用条件' }] : [] };
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const outline = await createOutline({ ...brief, mode: 'live' }, undefined, { evidence: structuredClone(evidence) });
    const revised = await reviseOutline(outline.id, outline.version, '请调整标题');
    confirmOutline(revised.id, revised.version); approved = confirmedOutline(revised.id, revised.version);
    const result = await runPipeline(approved.brief, undefined, { outline: approved, evidence: approved.evidence });
    assert.deepEqual(stages, ['outline', 'AI edit', 'writing', 'review', 'repair', 'review']);
    assert.equal(writes, 2); assert.equal(reviews, 2);
    assert.deepEqual(result.outline, { id: outline.id, version: 2 });
    assert.equal(result.drafts[0].titles[0], revised.platforms[0].title);
    assert.equal(result.review.issues.some(issue => issue.severity === 'error'), false);
  } finally {
    globalThis.fetch = old.fetch;
    for (const [field, value] of [['LLM_API_KEY', old.key], ['LLM_BASE_URL', old.base], ['LLM_MODEL', old.model]] as const) {
      if (value === undefined) delete process.env[field]; else process.env[field] = value;
    }
  }
});
test('immutable title and heading problems skip model repair and keep the real blocking result', async () => {
  const original = await make(); const platforms = structuredClone(original.platforms);
  platforms[0].title = '全球第一的模拟电脑'; platforms[0].sections[0].heading = '重量999 kg';
  const saved = saveOutline(original.id, 1, platforms); confirmOutline(saved.id, saved.version);
  const approved = confirmedOutline(saved.id, saved.version);
  const old = { fetch: globalThis.fetch, key: process.env.LLM_API_KEY }; let writes = 0; let reviews = 0;
  process.env.LLM_API_KEY = 'mock-only-fixed-structure';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const system = body.messages.find((message: { role: string }) => message.role === 'system').content;
    const output = system.includes('你根据用户已经确认的大纲展开正文')
      ? (writes++, { intro: '先从自己的选购任务出发，结合日常安排核对实际版本。', blocks: approved.platforms[0].sections.map(section => ({ id: section.id, text: evidence.facts.find(fact => section.factIds.includes(fact.id))?.statement || '请带上自己的任务清单到店核对。' })), cta: '欢迎到店核对自己的软件清单和所选配置。', tags: [] })
      : (reviews++, { summary: '标题含无依据排名', issues: [{ severity: 'error', category: 'compliance', target: 'title', platform: 'moments', message: '标题不应声称排名', suggestion: '回到大纲修改标题', resolution: 'auto_text' }] });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await runPipeline({ ...brief, mode: 'live' }, undefined, { outline: approved, evidence: approved.evidence });
    assert.equal(writes, 1); assert.equal(reviews, 1); assert.equal(result.review.status, 'blocked');
    assert.ok(result.review.issues.some(issue => issue.target === 'title' && issue.resolution === 'edit_outline'));
    assert.ok(result.review.issues.some(issue => issue.target === 'heading' && issue.resolution === 'edit_outline'));
    assert.equal(result.drafts[0].titles[0], platforms[0].title);
    assert.equal(result.drafts[0].blocks[0].heading, platforms[0].sections[0].heading);
    assert.ok(!result.trace.some(entry => entry.step === 'repair' && entry.status === 'running'));
  } finally { globalThis.fetch = old.fetch; if (old.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = old.key; }
});
test('semantic issues without a located field request manual review instead of a blind paid retry', async () => {
  const original = await make(); confirmOutline(original.id, 1); const approved = confirmedOutline(original.id, 1);
  const old = { fetch: globalThis.fetch, key: process.env.LLM_API_KEY }; let writes = 0; let reviews = 0;
  process.env.LLM_API_KEY = 'mock-only-unlocated-issue';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const system = body.messages.find((message: { role: string }) => message.role === 'system').content;
    const output = system.includes('你根据用户已经确认的大纲展开正文')
      ? (writes++, { intro: '先梳理自己的使用任务，带着具体问题确认实际版本。', blocks: approved.platforms[0].sections.map(section => ({ id: section.id, text: evidence.facts.find(fact => section.factIds.includes(fact.id))?.statement || '请带上自己的任务清单到店核对。' })), cta: '欢迎到店核对自己的软件清单和所选配置。', tags: [] })
      : (reviews++, { summary: '问题未定位', issues: [{ severity: 'error', category: 'fact', platform: 'moments', message: '存在需要人工定位的疑点', suggestion: '核对具体字段' }] });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await runPipeline({ ...brief, mode: 'live' }, undefined, { outline: approved, evidence: approved.evidence });
    assert.equal(writes, 1); assert.equal(reviews, 1); assert.equal(result.review.status, 'blocked');
    assert.ok(result.review.issues.some(issue => issue.id.startsWith('semantic-') && issue.resolution === 'manual_review'));
  } finally { globalThis.fetch = old.fetch; if (old.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = old.key; }
});
test('cancelling an in-flight model outline edit releases the lock and never saves partial work', async () => {
  const base = await make(); const old = { fetch: globalThis.fetch, key: process.env.LLM_API_KEY }; process.env.LLM_API_KEY = 'mock-only';
  let pause = false; let started!: () => void; const startedPromise = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async (_url, init) => {
    if (pause) return new Promise((_resolve, reject) => { started(); init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ platforms: base.platforms }) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const outline = await createOutline({ ...brief, mode: 'live' }, undefined, { evidence }); confirmOutline(outline.id, 1); pause = true;
    const controller = new AbortController(); const editing = reviseOutline(outline.id, 1, '请精简', controller.signal);
    await startedPromise; assert.throws(() => getOutline(outline.id), status(409)); controller.abort(); await assert.rejects(editing);
    assert.equal(getOutline(outline.id).version, 1); assert.equal(getOutline(outline.id).status, 'confirmed');
  } finally { globalThis.fetch = old.fetch; if (old.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = old.key; }
});
test('HTTP workflow enforces confirmation/version, keeps old SSE contract and protects local settings', async () => {
  const app = await createApp({ apiOnly: true }); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const request = (url: string, body: unknown, method = 'POST', headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const options = await (await fetch(base + '/api/task-options')).json(); assert.equal(options.operatorRole, 'salesperson'); assert.equal(options.scenarios.length, 8);
    assert.equal((await request('/api/connections/settings', {}, 'POST', { Origin: 'https://untrusted.invalid' })).status, 403);
    assert.equal((await request('/api/outlines', { platforms: ['moments'] })).status, 422);
    assert.equal((await request('/api/outlines', { ...brief, instructions: 'x'.repeat(300_000) })).status, 413);
    const outline = await make(); assert.equal((await request('/api/generate-from-outline', { outlineId: outline.id, version: 1 })).status, 409);
    assert.equal((await request(`/api/outlines/${outline.id}/confirm`, { version: 1 })).status, 200);
    const res = await request('/api/generate-from-outline', { outlineId: outline.id, version: 1 }); assert.match(res.headers.get('content-type')!, /text\/event-stream/);
    const data = await res.text(); assert.match(data, /"type":"progress"/); assert.match(data, /"type":"result"/); assert.doesNotMatch(data, /禁止回传的原始全文/);
    const event = data.split('\n\n').filter(frame => frame.startsWith('data:')).map(frame => JSON.parse(frame.slice(5))).find(e => e.type === 'result'); assert.ok(event.result);
    const stale = await request('/api/render', { runId: event.result.id, revision: 99, platform: 'moments', selectedTitleIndex: 0, templateId: 'moments-square' }); assert.equal(stale.status, 409);
    assert.equal((await fetch(base + '/api/render-assets/../../.env.local')).status, 404);
    assert.equal((await fetch(base + '/api/render-assets/00000000-0000-0000-0000-000000000000')).status, 410);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test('fixture render keeps blocked markers and denies downloads; attention ZIP carries safe provenance', async () => {
  const real = (await listProducts()).find(p => /HarmonyOS|鸿蒙/.test(p.system))!;
  const outline = await createOutline({ ...brief, productId: real.id }); confirmOutline(outline.id, 1);
  const result = await runPipeline(outline.brief, undefined, { evidence: outline.evidence, outline: confirmedOutline(outline.id, 1) });
  const req = { runId: result.id, revision: 1, platform: 'moments' as const, selectedTitleIndex: 0, templateId: 'moments-square' };
  result.review.status = 'blocked'; const blocked = await renderRun(result, req); assert.equal(blocked.zipUrl, undefined); assert.ok(blocked.artifacts.every(a => !a.downloadUrl));
  assert.ok((await getRenderAsset(blocked.artifacts[0].id)).data.length); await assert.rejects(getRenderAsset(blocked.artifacts[0].id, true), status(409));
  result.review.status = 'needs_attention'; const bundle = await renderRun(result, req); assert.ok(bundle.zipUrl);
  const handle = bundle.zipUrl.split('/').pop()!.split('?')[0]; const zip = await getRenderAsset(handle, true); const files = unzipSync(zip.data);
  assert.ok(files['来源与审核.md']); const report = strFromU8(files['来源与审核.md']); assert.match(report, /待确认/); assert.doesNotMatch(report, /https?:\/\/|\/api\/assets\/|[A-Z]:\\|kb_id|media_id/);
  assert.ok(Object.keys(files).some(name => name.endsWith('.png')));
});
