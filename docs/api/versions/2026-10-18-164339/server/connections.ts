import { connectionSettingsSchema } from './schemas.js';
import { WorkflowError } from './outlines.js';
let allowedModelHosts: ReadonlySet<string> | undefined;

/** Capture the server-controlled endpoint policy after dotenv has loaded. */
export function initializeConnectionPolicy() {
  if (allowedModelHosts) return;
  const hosts = new Set(['api.openai-next.com']);
  try { hosts.add(new URL(process.env.LLM_BASE_URL || 'https://api.openai-next.com').hostname); }
  catch { /* modelConfig provides the user-facing configuration error. */ }
  allowedModelHosts = hosts;
}
// This local, single-operator demo holds runtime credentials only in server memory.
// Never return these values or write them into archives, browser storage, or files.
export function updateConnections(input: unknown) {
  initializeConnectionPolicy();
  const settings = connectionSettingsSchema.parse(input);
  if (settings.baseUrl) {
    const url = new URL(settings.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !allowedModelHosts!.has(url.hostname) || (url.port && url.port !== '443')) throw new WorkflowError(400, '页面只允许 HTTPS 赛事网关或服务启动时配置的模型域名。其他服务请在服务端配置后重启。');
  }
  const fields = { baseUrl: 'LLM_BASE_URL', model: 'LLM_MODEL', apiKey: 'LLM_API_KEY', imaClientId: 'IMA_OPENAPI_CLIENTID', imaApiKey: 'IMA_OPENAPI_APIKEY', imaKbName: 'IMA_KB_NAME' } as const;
  for (const [key, variable] of Object.entries(fields)) {
    const value = settings[key as keyof typeof fields];
    if (value) process.env[variable] = value;
  }
  // Canonicalize aliases so the script and status use the same runtime settings.
  if (settings.imaClientId) process.env.IMA_CLIENT_ID = settings.imaClientId;
  if (settings.imaApiKey) process.env.IMA_API_KEY = settings.imaApiKey;
}
