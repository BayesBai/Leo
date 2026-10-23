import { connectionSettingsSchema } from './schemas.js';
import { WorkflowError } from './outlines.js';
import { DEFAULT_MODEL_BASE_URL, hasRealSecret, normalizeModelBaseUrl } from './model.js';
let allowedModelOrigins: ReadonlySet<string> | undefined;

/** Capture the server-controlled endpoint policy after dotenv has loaded. */
export function initializeConnectionPolicy() {
  if (allowedModelOrigins) return;
  const origins = new Set([new URL(DEFAULT_MODEL_BASE_URL).origin]);
  try { origins.add(new URL(normalizeModelBaseUrl(process.env.LLM_BASE_URL || DEFAULT_MODEL_BASE_URL)).origin); }
  catch { /* modelConfig provides the user-facing configuration error. */ }
  allowedModelOrigins = origins;
}
// This local, single-operator demo holds runtime credentials only in server memory.
// Never return these values or write them into archives, browser storage, or files.
export function updateConnections(input: unknown) {
  initializeConnectionPolicy();
  const settings = connectionSettingsSchema.parse(input);
  let baseUrl: string | undefined;
  if (settings.apiKey && !hasRealSecret(settings.apiKey)) throw new WorkflowError(400, '请填写有效的模型密钥，不能使用占位值。');
  if (settings.baseUrl) {
    try { baseUrl = normalizeModelBaseUrl(settings.baseUrl); }
    catch { throw new WorkflowError(400, '请填写有效的 HTTPS 模型 API 根地址，不要填写完整调用路径。'); }
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || !allowedModelOrigins!.has(url.origin) || (url.port && url.port !== '443')) throw new WorkflowError(400, '页面只允许 HTTPS 中转网关或服务启动时配置的模型地址。其他服务请在服务端配置后重启。');
    let currentOrigin: string | undefined;
    try { currentOrigin = new URL(normalizeModelBaseUrl(process.env.LLM_BASE_URL || DEFAULT_MODEL_BASE_URL)).origin; }
    catch { /* Repairing an invalid configuration still requires a new credential. */ }
    if (url.origin !== currentOrigin && (!hasRealSecret(settings.apiKey) || settings.apiKey === process.env.LLM_API_KEY?.trim())) {
      throw new WorkflowError(400, '更换模型服务地址时，必须同时填写该服务的新密钥，不能沿用原服务密钥。');
    }
  }
  const fields = { baseUrl: 'LLM_BASE_URL', model: 'LLM_MODEL', apiKey: 'LLM_API_KEY', imaClientId: 'IMA_OPENAPI_CLIENTID', imaApiKey: 'IMA_OPENAPI_APIKEY', imaKbName: 'IMA_KB_NAME' } as const;
  for (const [key, variable] of Object.entries(fields)) {
    const value = key === 'baseUrl' ? baseUrl : settings[key as keyof typeof fields];
    if (value) process.env[variable] = value;
  }
  // Canonicalize aliases so the script and status use the same runtime settings.
  if (settings.imaClientId) process.env.IMA_CLIENT_ID = settings.imaClientId;
  if (settings.imaApiKey) process.env.IMA_API_KEY = settings.imaApiKey;
}
