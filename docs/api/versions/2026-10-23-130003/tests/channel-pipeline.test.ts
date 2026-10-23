import test from 'node:test';
import assert from 'node:assert/strict';
import type { Brief, EvidenceBundle, OutlineResult, Platform, PlatformOutline } from '../shared/types.js';
import { createOutline, confirmOutline, reviseOutline, outlineRevisionPlatforms } from '../server/outlines.js';
import { assembleChannelRun, channelPipelineSignature, runChannelPipeline, type ChannelCheckpoint } from '../server/pipeline.js';
import { withModelExecution } from '../server/model.js';

const now = new Date().toISOString();
const product = { id: 'queue-fixture', name: '纯模拟协议机型', system: '模拟系统', category: '测试', description: '不是真实产品', imageCount: 4 };
const evidence: EvidenceBundle = { product, sourceMode: 'local', retrievedAt: now, warnings: [], sources: [],
  facts: [{ id: 'fact-screen', statement: '屏幕尺寸约为 14 英寸。', quote: '屏幕尺寸约为 14 英寸，具体配置以实际销售版本为准。', qualifiers: ['具体配置以实际销售版本为准。'], sourceTitle: '纯模拟来源', sourceMode: 'local', retrievedAt: now, status: 'supported' }],
  images: Array.from({ length: 4 }, (_, index) => ({ id: `img-${index}`, name: `模拟图${index}`, productId: product.id, sourceMode: 'local', sourceTitle: '模拟图索引', description: '模拟素材', width: 20, height: 20, url: `/api/assets/fake-${index}` })) };
const brief: Brief = { productId: product.id, audience: '大学新生', scene: '开学购机', goal: '到店体验', buyingStage: '对比选择', platforms: ['moments', 'poster'], instructions: '', mode: 'live', knowledgeSource: 'local' };
const body = '屏幕尺寸约为 14 英寸。具体配置以实际销售版本为准。带上自己的课程安排和常用软件清单，到店先打开一份文档核对字号与阅读方式，再根据自己的使用习惯比较实际版本，最后把需要询问的配置问题记录下来。';
function plan(platform: Platform): PlatformOutline {
  return { platform, title: platform === 'moments' ? '开学购机先整理自己的清单' : '带着课程清单到店核对', angle: '从学习任务出发', intro: '先梳理自己的学习安排。',
    sections: [{ id: 'b1', heading: '到店核对自己的文档', points: [body], factIds: ['fact-screen'] }], imageIds: ['img-0'], cta: '欢迎带上自己的清单到店核对。' };
}
function outline(): OutlineResult { return { id: 'fixture-outline', version: 1, status: 'confirmed', createdAt: now, brief: structuredClone(brief), product, evidence: structuredClone(evidence), platforms: brief.platforms.map(plan), warnings: [] }; }
function json(value: unknown) { return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }); }
function request(init?: RequestInit) {
  const input = JSON.parse(String(init?.body));
  const system = input.messages.find((message: { role: string }) => message.role === 'system').content as string;
  const user = input.messages.find((message: { role: string }) => message.role === 'user').content as string;
  return { system, user, platform: (JSON.parse(user.split('\n确认的大纲：')[0].split('\n稿件：')[0]).task as Brief).platforms[0] };
}
function writer(user: string) {
  const approved = JSON.parse(user.split('\n确认的大纲：')[1].split('\n仅修复')[0]) as PlatformOutline;
  return { intro: approved.intro, blocks: approved.sections.map(section => ({ id: section.id, text: body })), cta: approved.cta, tags: [] };
}

test('channel fingerprints ignore other channels and global versions, but include relevant qualifiers and prompts', () => {
  const initial = outline(); const signature = channelPipelineSignature(initial, 'moments');
  const edited = structuredClone(initial); edited.version++; edited.id = 'another-outline'; edited.platforms[1].title = '另一个海报标题';
  edited.evidence.facts.push({ ...edited.evidence.facts[0], id: 'unrelated', statement: '无关模拟事实' });
  assert.equal(channelPipelineSignature(edited, 'moments'), signature);
  edited.evidence.facts[0].qualifiers = ['不同的必要条件'];
  assert.notEqual(channelPipelineSignature(edited, 'moments'), signature);
});

test('a failed independent review keeps its paid writer checkpoint and retries review only', async () => {
  const old = globalThis.fetch; const approved = outline(); let saved: ChannelCheckpoint | undefined; let writes = 0, reviews = 0;
  globalThis.fetch = async (_url, init) => {
    const { system, user } = request(init);
    if (system.includes('你根据用户已经确认的大纲展开正文')) { writes++; return json(writer(user)); }
    if (++reviews === 1) return new Response('', { status: 524 });
    return json({ summary: '模拟独立审稿通过', issues: [] });
  };
  try {
    await assert.rejects(runChannelPipeline(approved, 'moments', { onCheckpoint: checkpoint => { saved = checkpoint; } }), /524/);
    assert.ok(saved?.draft); assert.equal(saved?.review, undefined); assert.equal(writes, 1);
    const result = await runChannelPipeline(approved, 'moments', { checkpoint: saved });
    assert.equal(result.completed, true); assert.equal(result.draft!.id, saved!.draft!.id); assert.equal(writes, 1); assert.equal(reviews, 2);
  } finally { globalThis.fetch = old; }
});

test('successful repair is checkpointed before recheck and is not repeated after recheck failure', async () => {
  const old = globalThis.fetch; const approved = outline(); let saved: ChannelCheckpoint | undefined; let writes = 0, reviews = 0;
  globalThis.fetch = async (_url, init) => {
    const { system, user } = request(init);
    if (system.includes('你根据用户已经确认的大纲展开正文')) { writes++; return json(writer(user)); }
    reviews++;
    if (reviews === 2) return new Response('', { status: 524 });
    return json({ summary: '模拟定向问题', issues: reviews === 1 ? [{ severity: 'error', category: 'fact', target: 'body', message: '模拟正文需调整', suggestion: '仅修正文案', platform: 'moments' }] : [] });
  };
  try {
    await assert.rejects(runChannelPipeline(approved, 'moments', { onCheckpoint: checkpoint => { saved = checkpoint; } }), /524/);
    assert.equal(saved?.repairAttempted, true); assert.equal(saved?.stage, 'recheck'); assert.equal(writes, 2);
    const result = await runChannelPipeline(approved, 'moments', { checkpoint: saved });
    assert.equal(result.completed, true); assert.equal(writes, 2); assert.equal(reviews, 3);
  } finally { globalThis.fetch = old; }
});

test('channel failure does not cancel a successful sibling; partial checkpoints cannot become a complete run', async () => {
  const old = globalThis.fetch; const approved = outline(); let siblingAborted = false;
  globalThis.fetch = async (_url, init) => {
    const { system, user, platform } = request(init);
    if (platform === 'moments') return new Response('', { status: 401 });
    init?.signal?.addEventListener('abort', () => { siblingAborted = true; });
    await new Promise(resolve => setTimeout(resolve, 15));
    return json(system.includes('你根据用户已经确认的大纲展开正文') ? writer(user) : { summary: '模拟通过', issues: [] });
  };
  try {
    const results = await Promise.allSettled(approved.brief.platforms.map(platform => runChannelPipeline(approved, platform)));
    assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled'); assert.equal(siblingAborted, false);
    const checkpoint = (results[1] as PromiseFulfilledResult<ChannelCheckpoint>).value;
    assert.throws(() => assembleChannelRun(approved, [checkpoint]), /所有渠道/);
  } finally { globalThis.fetch = old; }
});

test('outline channels checkpoint independently and failed planning does not buy successful channels again', async () => {
  const old = globalThis.fetch; const channels: Partial<Record<Platform, PlatformOutline>> = {}; const calls: Platform[] = []; let failOnce = true;
  globalThis.fetch = async (_url, init) => {
    const user = JSON.parse(JSON.parse(String(init?.body)).messages.find((message: { role: string }) => message.role === 'user').content);
    assert.equal(user.task.platforms.length, 1); const platform: Platform = user.task.platforms[0]; calls.push(platform);
    if (platform === 'poster' && failOnce) { failOnce = false; return new Response('', { status: 524 }); }
    await new Promise(resolve => setTimeout(resolve, 10)); return json({ platforms: [plan(platform)] });
  };
  try {
    const options = { evidence, channels, onChannel: (platform: Platform, result: PlatformOutline) => { channels[platform] = result; } };
    await assert.rejects(createOutline(brief, undefined, options), /524/);
    assert.ok(channels.moments); assert.equal(channels.poster, undefined);
    const result = await createOutline(brief, undefined, options);
    assert.equal(result.platforms.length, 2); assert.equal(calls.filter(value => value === 'moments').length, 1); assert.equal(calls.filter(value => value === 'poster').length, 2);
    confirmOutline(result.id, 1); calls.length = 0;
    const revised = await reviseOutline(result.id, 1, '只调整海报标题', undefined, { platforms: ['poster'] });
    assert.deepEqual(calls, ['poster']); assert.deepEqual(revised.platforms[0], result.platforms[0]);
    assert.deepEqual(outlineRevisionPlatforms('精简小红书，所有渠道保持事实条件', ['moments', 'poster']), ['moments', 'poster']);
  } finally { globalThis.fetch = old; }
});

test('model telemetry attributes parallel nodes to their own channel and actual stage', async () => {
  const old = globalThis.fetch; const approved = outline(); const records: { stage: string; platform?: Platform }[] = [];
  globalThis.fetch = async (_url, init) => { const { system, user } = request(init); return json(system.includes('你根据用户已经确认的大纲展开正文') ? writer(user) : { summary: '模拟通过', issues: [] }); };
  try {
    const checkpoints = await withModelExecution({ jobId: 'fixture-job', onCall: record => { if (record.outcome === 'succeeded') records.push(record); } }, () => Promise.all(approved.brief.platforms.map(platform => runChannelPipeline(approved, platform))));
    assert.ok(records.some(record => record.stage === 'write' && record.platform === 'moments'));
    assert.ok(records.some(record => record.stage === 'review' && record.platform === 'poster'));
    const result = assembleChannelRun(approved, checkpoints, 'fixture-run');
    assert.equal(result.id, 'fixture-run'); assert.equal(result.drafts.length, 2); assert.equal(result.review.reviewedBy, 'rules+model');
  } finally { globalThis.fetch = old; }
});

test('a blocked channel keeps the whole-run gate blocked and immutable issues never trigger repair', async () => {
  const old = globalThis.fetch; const approved = outline(); let writes = 0;
  globalThis.fetch = async (_url, init) => {
    const { system, user, platform } = request(init);
    if (system.includes('你根据用户已经确认的大纲展开正文')) { writes++; return json(writer(user)); }
    return json({ summary: '模拟结构问题', issues: platform === 'moments' ? [{ severity: 'error', category: 'fact', target: 'title', platform, message: '标题存在必须返回大纲处理的问题', suggestion: '返回大纲修改', resolution: 'auto_text' }] : [] });
  };
  try {
    const checkpoints = await Promise.all(approved.brief.platforms.map(platform => runChannelPipeline(approved, platform)));
    const result = assembleChannelRun(approved, checkpoints);
    assert.equal(writes, 2); assert.equal(result.review.status, 'blocked');
    assert.ok(result.review.issues.some(issue => issue.platform === 'moments' && issue.target === 'title' && issue.resolution === 'edit_outline'));
    assert.equal(checkpoints[0].repairAttempted, undefined);
  } finally { globalThis.fetch = old; }
});

test('a durable successful recheck is not repeated if completion persistence is interrupted', async () => {
  const old = globalThis.fetch; const approved = outline(); const controller = new AbortController(); let saved: ChannelCheckpoint | undefined; let writes = 0, reviews = 0;
  globalThis.fetch = async (_url, init) => {
    const { system, user } = request(init);
    if (system.includes('你根据用户已经确认的大纲展开正文')) { writes++; return json(writer(user)); }
    return json({ summary: '模拟复审', issues: ++reviews === 1 ? [{ severity: 'error', category: 'fact', target: 'body', message: '模拟可改正文问题', suggestion: '定向调整正文' }] : [] });
  };
  try {
    await assert.rejects(runChannelPipeline(approved, 'moments', { signal: controller.signal, onCheckpoint: checkpoint => { saved = checkpoint; if (checkpoint.rechecked) controller.abort(); } }));
    assert.equal(saved?.rechecked, true); assert.equal(saved?.completed, undefined);
    const result = await runChannelPipeline(approved, 'moments', { checkpoint: saved });
    assert.equal(result.completed, true); assert.equal(writes, 2); assert.equal(reviews, 2);
  } finally { globalThis.fetch = old; }
});
