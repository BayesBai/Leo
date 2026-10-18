import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AppStatus, Brief, EvidenceBundle, RunResult, StreamEvent } from '../shared/types.js';
import { getAsset, getImaStatus, getLocalStats, listProducts, verifyIma } from './knowledge.js';
import { modelConfig } from './model.js';
import { InputRequiredError, parseBrief, publicResult, revisionPlatforms, runPipeline } from './pipeline.js';
import { platformSchema } from './schemas.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
dotenv.config({ path: path.join(root, '.env.local'), override: false });
dotenv.config({ path: path.join(root, '.env'), override: false });

const RUN_TTL = 30 * 60 * 1000;
const runs = new Map<string, { result: RunResult; canonicalEvidence: EvidenceBundle; touched: number }>();
let activeRuns = 0;
let initialSample: Promise<RunResult> | undefined;

function saveRun(result: RunResult, canonicalEvidence: EvidenceBundle = result.evidence) {
  const now = Date.now();
  for (const [id, run] of runs) if (now - run.touched > RUN_TTL) runs.delete(id);
  while (runs.size >= 40) runs.delete(runs.keys().next().value!);
  runs.set(result.id, { result, canonicalEvidence, touched: now });
}

async function status(): Promise<AppStatus> {
  const { configured, name, baseUrl } = modelConfig();
  return { model: { configured, name, baseUrl }, ima: getImaStatus(), local: await getLocalStats() };
}

function safeError(error: unknown): string {
  if (error && typeof error === 'object' && 'type' in error) {
    if (error.type === 'entity.parse.failed') return '请求不是有效的 JSON，请检查输入格式。';
    if (error.type === 'entity.too.large') return '请求内容过长，请减少附加要求后重试。';
  }
  if (error instanceof z.ZodError) return error.issues.map(issue => `${issue.path.join('.') || '输入'}：${issue.message}`).join('；');
  let message = error instanceof Error ? error.message : '操作失败，请重试。';
  for (const variable of ['LLM_API_KEY', 'IMA_OPENAPI_APIKEY', 'IMA_OPENAPI_CLIENTID', 'IMA_API_KEY', 'IMA_CLIENT_ID']) {
    const value = process.env[variable];
    if (value && value.length > 3) message = message.split(value).join('[已隐藏]');
  }
  return message.replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[已隐藏]').slice(0, 1200);
}

export async function createApp(options: { production?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/api/status', async (_req, res, next) => { try { res.json(await status()); } catch (error) { next(error); } });
  app.get('/api/products', async (_req, res, next) => { try { res.json({ products: await listProducts() }); } catch (error) { next(error); } });
  app.post('/api/connections/verify', async (_req, res, next) => {
    try { await verifyIma(); res.json(await status()); } catch (error) { next(error); }
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

  const streamRun = (revise: boolean): express.RequestHandler => async (req, res) => {
    if (activeRuns >= 2) { res.status(429).json({ message: '已有任务正在运行，请等待完成或先取消。' }); return; }
    const controller = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let started = false;
    const send = (event: StreamEvent) => {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      let brief: Brief;
      let prior: RunResult | undefined;
      let canonicalEvidence: EvidenceBundle | undefined;
      if (revise) {
        const input = z.object({ runId: z.string().min(1).max(100), instructions: z.string().trim().min(1, '请填写修改要求。').max(2000), platforms: z.array(platformSchema).min(1).max(2).optional() }).parse(req.body);
        const saved = runs.get(input.runId);
        if (!saved || Date.now() - saved.touched > RUN_TTL) { res.status(410).json({ message: '上次任务已过期，请重新生成。' }); return; }
        prior = saved.result; saved.touched = Date.now();
        canonicalEvidence = saved.canonicalEvidence;
        const inferredPlatforms = revisionPlatforms(input.instructions);
        if (!input.platforms && !inferredPlatforms && /(?:换|切换)平台/.test(input.instructions)) {
          throw new InputRequiredError([{ field: 'platforms', question: '希望改成哪个平台？请写明小红书、公众号、朋友圈或海报。' }]);
        }
        brief = parseBrief({ ...prior.brief, instructions: input.instructions, platforms: input.platforms || inferredPlatforms || prior.brief.platforms });
      } else brief = parseBrief(req.body);
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
      });
      saveRun(result, canonicalEvidence); send({ type: 'result', result: publicResult(result) });
    } catch (error) {
      if (error instanceof InputRequiredError) {
        if (started) send({ type: 'needs_input', message: error.message, fields: error.fields });
        else res.status(422).json({ type: 'needs_input', message: error.message, fields: error.fields });
      } else if (!controller.signal.aborted) {
        if (started) send({ type: 'error', message: safeError(error) });
        else res.status(error instanceof z.ZodError ? 400 : 500).json({ message: safeError(error) });
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (started) activeRuns--;
      if (!res.writableEnded) res.end();
    }
  };
  app.post('/api/generate', streamRun(false));
  app.post('/api/revise', streamRun(true));
  app.use('/api', (_req, res) => { res.status(404).json({ message: '未找到该接口。' }); });

  if (options.production) {
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
    const suppliedStatus = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
    res.status(error instanceof z.ZodError ? 400 : Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599 ? suppliedStatus : 500).json({ message: safeError(error) });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const app = await createApp({ production });
  const server = app.listen(port, host);
  server.once('listening', () => {
    console.log(`\n  知序 · PC 内容工作台\n  Local: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n  本地演示可用；真实模型与 ima 状态请查看工作台。\n`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用。请在 .env.local 设置其他 PORT 后重启。` : safeError(error));
    process.exitCode = 1;
  });
}
