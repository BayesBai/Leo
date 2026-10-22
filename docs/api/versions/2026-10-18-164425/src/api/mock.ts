import fixture from '../../docs/api/versions/2026-10-18-150507/fixtures/frontend.mock.json';
import type { AppStatus, Product, ReviewReport, RunResult, StreamEvent, TraceEntry } from '../../shared/types';
import { ApiError, type Api, type RunOutcome } from './client';

/**
 * 模拟数据层。数据全部来自交接夹具，不发网络请求。
 * 场景通过地址参数选择：?mock=ok | blocked | needs_input | error | empty | slow | expired
 * 模拟 ID 只在这里流转，不会发送到真实的生成或修改接口。
 */
export type MockScenario = 'ok' | 'blocked' | 'needs_input' | 'error' | 'empty' | 'slow' | 'expired';
const SCENARIOS: MockScenario[] = ['ok', 'blocked', 'needs_input', 'error', 'empty', 'slow', 'expired'];

export function mockScenario(search = window.location.search): MockScenario | null {
  const value = new URLSearchParams(search).get('mock');
  if (value === null) return null;
  return (SCENARIOS as string[]).includes(value) ? (value as MockScenario) : 'ok';
}

const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
  const timer = window.setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

const clone = <T,>(value: T): T => structuredClone(value);
const base = fixture.result as unknown as RunResult;
const products = fixture.products.products as unknown as Product[];
const progress = (fixture.progressEvents as unknown as StreamEvent[]).map(event => event.entry as TraceEntry);

function sampleResult(scenario: MockScenario): RunResult {
  const result = clone(base);
  if (scenario === 'blocked') result.review = clone(fixture.variants.blockedReview) as unknown as ReviewReport;
  return result;
}

export function createMockApi(scenario: MockScenario): Api {
  let revision = base.revision;
  const status = clone(fixture.status) as AppStatus;
  return {
    mock: true,
    async getStatus(signal) { await delay(200, signal); return clone(status); },
    async getProducts(signal) { await delay(300, signal); return scenario === 'empty' ? [] : clone(products); },
    async getSample(signal) {
      await delay(400, signal);
      if (scenario === 'empty') throw new ApiError('演示内容载入失败（404）', 'http', 404);
      return sampleResult(scenario);
    },
    async verifyIma(signal) { await delay(600, signal); return clone(status); },
    async generate(brief, handlers, signal) { return run(brief.platforms, undefined, handlers, signal); },
    async revise(input, handlers, signal) {
      if (scenario === 'expired') throw new ApiError(fixture.httpErrors[2].body.message, 'expired', 410);
      return run(input.platforms, input.instructions, handlers, signal);
    },
  };

  async function run(platforms: string[] | undefined, instructions: string | undefined, handlers: { onProgress?: (entry: TraceEntry) => void }, signal?: AbortSignal): Promise<RunOutcome> {
    const step = scenario === 'slow' ? 1200 : 450;
    for (const entry of progress) { await delay(step, signal); handlers.onProgress?.({ ...entry, at: new Date().toISOString() }); }
    await delay(step, signal);
    if (scenario === 'needs_input') { const event = fixture.terminalEvents.needs_input; return { type: 'needs_input', message: event.message, fields: event.fields }; }
    if (scenario === 'error') return { type: 'error', message: fixture.terminalEvents.error.message };
    const result = sampleResult(scenario);
    revision = instructions ? revision + 1 : 1;
    result.revision = revision;
    result.id = `run-mock-${Date.now().toString(36)}`;
    result.createdAt = new Date().toISOString();
    if (platforms?.length) result.brief.platforms = platforms as RunResult['brief']['platforms'];
    if (instructions) result.brief.instructions = instructions;
    return { type: 'result', result };
  }
}
