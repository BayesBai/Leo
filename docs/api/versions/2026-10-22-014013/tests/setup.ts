import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSyntheticKnowledgeBase } from './fixtures/synthetic-kb.js';

// Each Node test worker owns its files and state. Never load .env/.env.local or
// inherit usable credentials or private knowledge roots from the calling shell.
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'hackson-tests-'));
process.once('exit', () => { rmSync(testRoot, { recursive: true, force: true }); });
const knowledgeRoot = path.join(testRoot, 'knowledge');
const stateRoot = path.join(testRoot, 'state');
await Promise.all([writeSyntheticKnowledgeBase(knowledgeRoot), mkdir(stateRoot, { recursive: true })]);

process.env.NODE_ENV = 'test';
process.env.LOCAL_KB_ROOT = knowledgeRoot;
process.env.AGENT_STATE_DIR = stateRoot;
process.env.LLM_API_KEY = 'test-only-model-key';
process.env.LLM_BASE_URL = 'https://relay.nccnxta.cn/v1';
process.env.LLM_MODEL = 'gpt-6.1-sol';
process.env.LLM_TIMEOUT_MS = '180000';
delete process.env.LLM_THINKING;
process.env.IMA_CLIENT_ID = process.env.IMA_OPENAPI_CLIENTID = 'test-only-ima-client';
process.env.IMA_API_KEY = process.env.IMA_OPENAPI_APIKEY = 'test-only-ima-key';
process.env.IMA_KB_NAME = '纯模拟测试知识库';
process.env.IMA_ACCOUNT_LABEL = '纯模拟测试账号';
process.env.IMA_SKILL_PATH = path.join(testRoot, 'forbid-ima.cjs');
process.env.IMA_LAST_CHECK_FILE = path.join(testRoot, 'ima-check');
await writeFile(process.env.IMA_SKILL_PATH, "throw new Error('Default tests must explicitly mock ima requests');\n");

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('默认测试禁止外部网络请求；请显式提供模拟响应。');
  }
  // A loopback response must not redirect the native fetch implementation to an
  // external origin behind this guard.
  return nativeFetch(input, { ...init, redirect: 'error' });
};
