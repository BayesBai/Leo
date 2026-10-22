import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AppStatus, Brief, EvidenceBundle, OutlineResult, RunResult, StreamEvent } from '../shared/types.js';
import { getAsset, getImaStatus, getLocalStats, listProducts, verifyIma, assertEvidenceCurrent } from './knowledge.js';
import { callModel, modelConfig } from './model.js';
import { InputRequiredError, parseBrief, publicResult, revisionPlatforms, runPipeline } from './pipeline.js';
import { outlineEditSchema, outlineReviseSchema, outlineVersionSchema, platformSchema, renderRequestSchema } from './schemas.js';
import { confirmedOutline, confirmOutline, createOutline, getOutline, publicOutline, reviseOutline, saveOutline, WorkflowError } from './outlines.js';
import { initializeConnectionPolicy, updateConnections } from './connections.js';
import { taskOptions } from './task-options.js';
import { getRenderAsset, renderRun, renderTemplates } from './render/index.js';
import { getSavedRun, historyItems, pruneHistory, runDetail, saveRun } from './history.js';
import { stateStore, markOperation, finishOperation } from './state-store.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let activeRuns = 0;
let initialSample: Promise<RunResult> | undefined;
let activeOperations = 0;

async function status(): Promise<AppStatus> {
  const { configured, name, baseUrl } = modelConfig();
  return { model: { configured, name, baseUrl }, ima: getImaStatus(), local: await getLocalStats() };
}

function safeError(error: unknown): string {
  if (error && typeof error === 'object' && 'type' in error) {
    if (error.type === 'entity.parse.failed') return '请求不是有效的 JSON，请检查输入格式。';
    if (error.type === 'entity.too.large') return '请求内容超过 256 KB，请减少大纲要点或附加要求后重试。';
  }
  let message = error instanceof z.ZodError
    ? error.issues.map(issue => `${issue.path.join('.') || '输入'}：${issue.code === 'invalid_enum_value' ? '值不在允许的选项中。' : issue.code === 'unrecognized_keys' ? '包含不支持的字段。' : issue.message}`).join('；')
    : error instanceof Error ? error.message : '操作失败，请重试。';
  for (const variable of ['LLM_API_KEY', 'IMA_OPENAPI_APIKEY', 'IMA_OPENAPI_CLIENTID', 'IMA_API_KEY', 'IMA_CLIENT_ID']) {
    const value = process.env[variable];
    if (value && value.length > 3) message = message.split(value).join('[已隐藏]');
  }
  return message.replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[已隐藏]')
    .replace(/[A-Za-z]:[\\/][^\r\n，。；"'<>|]*/g, '[本地路径已隐藏]')
    .replace(/(?:\\\\[^\s\\]+\\|\/(?:Users|home|tmp|workspace|private|var|app)\/)[^\r\n，。；"'<>|]*/g, '[本地路径已隐藏]')
    .slice(0, 1200);
}

function authorityUrl(authority: string | undefined): URL | undefined {
  if (!authority || authority !== authority.trim() || /[\s/@?#\\]/.test(authority)) return;
  try {
    const url = new URL(`http://${authority}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return;
    return url;
  } catch { return; }
}

// Hold the configuration lock until actual async cleanup completes, even when a client disconnects.
const operation = (handler: express.RequestHandler): express.RequestHandler => async (req, res, next) => {
  if (activeOperations >= 4) { res.status(429).json({ message: '当前任务较多，请稍后重试。' }); return; }
  activeOperations++;
  try { await handler(req, res, next); }
  catch (error) { next(error); }
  finally { activeOperations--; }
};

export async function createApp(options: { production?: boolean; apiOnly?: boolean } = {}) {
  initializeConnectionPolicy(); stateStore(); pruneHistory();
  const app = express();
  app.disable('x-powered-by');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const configuredHost = process.env.HOST;
  if (configuredHost && !['0.0.0.0', '::', '[::]'].includes(configuredHost)) {
    const configured = authorityUrl(configuredHost.includes(':') && !configuredHost.startsWith('[') ? `[${configuredHost}]` : configuredHost);
    if (configured) allowedHosts.add(configured.hostname);
  }
  app.use((req, res, next) => {
    const requested = authorityUrl(req.get('host'));
    if (!requested || !allowedHosts.has(requested.hostname)) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(403).json({ message: '请求的主机名未获允许，请使用本机地址或服务端明确配置的 HOST。' }); return;
    }
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin) {
        try {
          const parsed = new URL(origin); const requested = authorityUrl(req.get('host'))!;
          if (parsed.protocol !== `${req.protocol}:` || parsed.origin !== origin || parsed.host !== requested.host) throw new Error();
        }
        catch { res.status(403).json({ message: '不允许跨站修改本地工作台。' }); return; }
      }
      if (req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ message: '不允许跨站修改本地工作台。' }); return; }
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/status', async (_req, res, next) => { try { res.json(await status()); } catch (error) { next(error); } });
  app.get('/api/products', async (_req, res, next) => { try { res.json({ products: await listProducts() }); } catch (error) { next(error); } });
  app.post('/api/connections/verify', operation(async (_req, res, next) => {
    const controller = new AbortController(); res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try { await verifyIma(controller.signal); res.json(await status()); } catch (error) { if (!controller.signal.aborted) next(error); }
  }));
  app.get('/api/task-options', (_req, res) => { res.json(taskOptions); });
  app.get('/api/history', (_req, res, next) => { try { pruneHistory(); res.json({ items: historyItems() }); } catch (error) { next(error); } });
  app.get('/api/runs/:id', (req, res, next) => { try { res.json(runDetail(String(req.params.id))); } catch (error) { next(error); } });
  app.post('/api/connections/settings', async (req, res, next) => {
    try {
      if (activeOperations) throw new WorkflowError(409, '请等待正在进行的任务结束后再修改接入配置。');
      updateConnections(req.body); res.json(await status());
    } catch (error) { next(error); }
  });
  app.post('/api/connections/model/verify', operation(async (req, res, next) => {
    const controller = new AbortController(); req.on('close', () => { if (!req.complete) controller.abort(); });
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try { await callModel('仅返回 OK。', '连接测试', { signal: controller.signal, maxTokens: 256 }); res.json({ verified: true, message: '模型接口已返回有效文本。' }); }
    catch (error) { if (!controller.signal.aborted) next(error); }
  }));
  const outlineAction = (action: (req: express.Request, signal: AbortSignal) => Promise<OutlineResult> | OutlineResult): express.RequestHandler => async (req, res, next) => {
    const controller = new AbortController(); res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try { res.json(publicOutline(await action(req, controller.signal))); } catch (error) { if (!controller.signal.aborted) next(error); }
  };
  app.post('/api/outlines', operation(outlineAction((req, signal) => createOutline(parseBrief(req.body), signal))));
  app.get('/api/outlines/:id', outlineAction(req => getOutline(String(req.params.id))));
  app.put('/api/outlines/:id', operation(outlineAction(req => { const input = outlineEditSchema.parse(req.body); return saveOutline(String(req.params.id), input.version, input.platforms); })));
  app.post('/api/outlines/:id/revise', operation(outlineAction((req, signal) => { const input = outlineReviseSchema.parse(req.body); return reviseOutline(String(req.params.id), input.version, input.instructions, signal); })));
  app.post('/api/outlines/:id/confirm', operation(outlineAction(req => { const input = outlineVersionSchema.parse(req.body); return confirmOutline(String(req.params.id), input.version); })));
  app.get('/api/render-templates', (_req, res) => { res.json({ templates: renderTemplates }); });
  app.post('/api/render', operation(async (req, res, next) => {
    const controller = new AbortController(); res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const input = renderRequestSchema.parse(req.body); const saved = getSavedRun(input.runId);
      if (saved.result.revision !== input.revision) throw new WorkflowError(409, '正文版本不一致，请使用当前结果。');
      assertEvidenceCurrent(saved.canonicalEvidence);
      res.json(await renderRun(saved.result, input, controller.signal));
    } catch (error) { if (!controller.signal.aborted) next(error); }
  }));
  app.get('/api/render-assets/:handle', async (req, res, next) => {
    try {
      const asset = await getRenderAsset(String(req.params.handle), req.query.download === '1');
      res.setHeader('Content-Type', asset.type);
      if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="artifact.${asset.extension}"; filename*=UTF-8''${encodeURIComponent(asset.name)}`);
      if (asset.type.startsWith('text/html')) res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'");
      res.send(asset.data);
    } catch (error) { next(error); }
  });
  app.get('/api/assets/:handle', async (req, res, next) => {
    try {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(req.params.handle))) { res.status(400).json({ message: '图片引用无效。' }); return; }
      const asset = await getAsset(String(req.params.handle));
      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(asset.data);
    } catch (error) { res.status(404).json({ message: safeError(error) }); }
  });
  app.get('/api/sample', async (_req, res, next) => {
    try {
      if (!initialSample) initialSample = (async () => {
        const products = await listProducts();
        const product = products.find(item => /MateBook 14/.test(item.name) && /鸿蒙|HarmonyOS/i.test(item.system + item.name)) || products[0];
        if (!product) throw new Error('未找到本地产品资料。请配置 LOCAL_KB_ROOT，或检查项目知识库目录。');
        return runPipeline({
          productId: product.id, audience: '大学新生', scene: '开学购机', goal: '到店体验',
          buyingStage: '对比选择', platforms: ['xiaohongshu', 'wechat'], instructions: '', mode: 'demo', knowledgeSource: 'local',
        });
      })().catch(error => { initialSample = undefined; throw error; });
      const result = await initialSample;
      saveRun(result); res.json(publicResult(result));
    } catch (error) { next(error); }
  });

  const streamRun = (revise: boolean | 'outline'): express.RequestHandler => async (req, res) => {
    if (activeRuns >= 2) { res.status(429).json({ message: '已有任务正在运行，请等待完成或先取消。' }); return; }
    const controller = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let started = false;
    let operationId: string | undefined;
    const send = (event: StreamEvent) => {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      let brief: Brief;
      let prior: RunResult | undefined;
      let canonicalEvidence: EvidenceBundle | undefined;
      let outline: OutlineResult | undefined;
      if (revise === 'outline') {
        const input = z.object({ outlineId: z.string().min(1).max(100), version: z.number().int().min(1) }).strict().parse(req.body);
        outline = confirmedOutline(input.outlineId, input.version); brief = outline.brief; canonicalEvidence = outline.evidence; operationId = outline.id;
      } else if (revise) {
        const input = z.object({ runId: z.string().min(1).max(100), instructions: z.string().trim().min(1, '请填写修改要求。').max(2000), platforms: z.array(platformSchema).min(1).max(4).optional() }).parse(req.body);
        const saved = getSavedRun(input.runId, true); prior = saved.result; operationId = input.runId;
        canonicalEvidence = saved.canonicalEvidence;
        const inferredPlatforms = revisionPlatforms(input.instructions);
        if (!input.platforms && !inferredPlatforms && /(?:换|切换)平台/.test(input.instructions)) {
          throw new InputRequiredError([{ field: 'platforms', question: '希望改成哪个平台？请写明小红书、公众号、朋友圈或海报。' }]);
        }
        brief = parseBrief({ ...prior.brief, instructions: input.instructions, platforms: input.platforms || inferredPlatforms || prior.brief.platforms });
      } else brief = parseBrief(req.body);
      if (operationId) operationId = markOperation(operationId, 'generate');
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      started = true; activeRuns++;
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15_000);
      const result = await runPipeline(brief, entry => send({ type: 'progress', entry }), {
        signal: controller.signal,
        evidence: canonicalEvidence,
        previous: prior,
        onEvidence: evidence => { canonicalEvidence = evidence; },
        revision: prior ? prior.revision + 1 : 1,
        outline,
      });
      controller.signal.throwIfAborted();
      saveRun(result, canonicalEvidence, outline); send({ type: 'result', result: publicResult(result) });
    } catch (error) {
      if (error instanceof InputRequiredError) {
        if (started) send({ type: 'needs_input', message: error.message, fields: error.fields });
        else res.status(422).json({ type: 'needs_input', message: error.message, fields: error.fields });
      } else if (!controller.signal.aborted) {
        if (started) send({ type: 'error', message: safeError(error) });
        else res.status(error instanceof z.ZodError ? 400 : error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500).json({ message: safeError(error) });
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (operationId) { try { finishOperation(operationId); } catch { /* preserve concurrency cleanup even when storage is unavailable */ } }
      if (started) activeRuns--;
      if (!res.writableEnded) res.end();
    }
  };
  app.post('/api/generate', operation(streamRun(false)));
  app.post('/api/revise', operation(streamRun(true)));
  app.post('/api/generate-from-outline', operation(streamRun('outline')));
  app.use('/api', (_req, res) => { res.status(404).json({ message: '未找到该接口。' }); });

  if (options.apiOnly) {
    // Contract tests and API consumers can omit both Vite and static hosting.
  } else if (options.production) {
    const dist = path.join(root, 'dist');
    if (!existsSync(path.join(dist, 'index.html'))) throw new Error('未找到构建产物，请先运行 npm run build。');
    app.use(express.static(dist));
    app.get('/{*splat}', (_req, res) => { res.sendFile(path.join(dist, 'index.html')); });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof InputRequiredError) { res.status(422).json({ type: 'needs_input', message: error.message, fields: error.fields }); return; }
    const suppliedStatus = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
    res.status(error instanceof z.ZodError ? 400 : Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599 ? suppliedStatus : 500).json({ message: safeError(error) });
  });
  return app;
}
