import { promises as fs, existsSync, readFileSync, realpathSync, lstatSync, realpath as fsRealpath } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EvidenceBundle, Fact, ImageAsset, Product, KnowledgeSource } from '../shared/types';
import catalogSeed from './catalog-seed.json';
import { stateStore, stateDirectory } from './state-store.js';

const execFileAsync = promisify(execFile);
// The callback implementation resolves junctions safely and also works in Windows app sandboxes
// where the native GetFinalPathNameByHandle variant used by fs.promises.realpath can return EPERM.
const realpathAsync = promisify(fsRealpath);
const TTL = 30 * 60_000;
const MAX_ASSET = 15 * 1024 * 1024;
const SKU_NOTE = '配置可能因销售版本而异，请以实际销售版本为准；不得跨系统、年份、屏幕或处理器版本套用。';
const DEFAULT_KB = '任德耀新建华为PC知识库';
type JsonRecord = Record<string, any>;
interface CatalogEntry { product: Product; directory: string; root: string; text: string; folderName: string; images: ImageAsset[]; hasLocal: boolean; sourceFiles?: { relative: string; sha256: string }[] }
type AssetEntry = { file: string; directory: string; root: string; contentType: string; sha256: string } | { data: Buffer; contentType: string; expiresAt: number; configuration: string };
type SavedAsset = { kind: 'local'; relativeFile: string; relativeDirectory: string; root: string; contentType: string; sha256: string } | { kind: 'ima'; contentType: string; expiresAt: number; configuration: string };
export interface EvidenceBinding { source: KnowledgeSource; root?: string; files?: { relative: string; sha256: string }[]; configuration?: string }
const bindings = new Map<string, EvidenceBinding>();
const bindingKey = (e: EvidenceBundle) => `${e.sourceMode}:${e.product.id}:${e.retrievedAt}`;
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
let assetsRestored = false;
async function restoreAssets() {
  if (assetsRestored) return;
  for (const [handle, saved] of stateStore().entries<SavedAsset>('knowledgeAssets')) {
    if (!/^[0-9a-f-]{36}$/i.test(handle)) continue;
    if (saved.kind === 'local' && saved.root === localRoot()) {
      const file = path.resolve(saved.root, saved.relativeFile); const directory = path.resolve(saved.root, saved.relativeDirectory);
      if (!within(saved.root, file) || !within(saved.root, directory)) continue;
      assetStore.set(handle, { file, directory, root: saved.root, contentType: saved.contentType, sha256: saved.sha256 }); fileHandles.set(file, handle);
    } else if (saved.kind === 'ima' && saved.expiresAt > Date.now() && saved.configuration === imaConfiguration()) {
      const data = await fs.readFile(path.join(stateDirectory(), 'media', handle)).catch(() => undefined);
      if (data && detectImageType(data) === saved.contentType) assetStore.set(handle, { ...saved, data });
    }
  }
  assetsRestored = true;
}
export function captureEvidenceBinding(e: EvidenceBundle) { return structuredClone(bindings.get(bindingKey(e))); }
export function rememberEvidenceBinding(e: EvidenceBundle, binding?: EvidenceBinding) { if (binding) bindings.set(bindingKey(e), structuredClone(binding)); }
export function restoreEvidenceBinding(e: EvidenceBundle, binding?: EvidenceBinding) {
  const valid = binding?.source === e.sourceMode && (binding.source === 'ima' ? /^[a-f0-9]{64}$/.test(binding.configuration || '') : !!binding.root && !!binding.files?.length && binding.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)));
  rememberEvidenceBinding(e, valid ? binding : { source: e.sourceMode, root: '', files: [], configuration: 'invalid' });
}
export function assertEvidenceCurrent(e: EvidenceBundle) {
  const b = bindings.get(bindingKey(e));
  if (e.sourceMode === 'ima') {
    const age = Date.now() - Date.parse(e.retrievedAt);
    if (!Number.isFinite(age) || age < 0 || age >= TTL || b?.configuration && b.configuration !== imaConfiguration()) throw new KnowledgeError('ima 资料已过期或接入配置已改变，请按原任务重新取证策划。', 'EVIDENCE_EXPIRED', 410);
  } else if (b) {
    try {
      if (b.root !== localRoot()) throw new Error('root');
      for (const file of b.files || []) {
        const target = path.resolve(b.root!, file.relative); const real = realpathSync(target);
        if (!within(realpathSync(b.root!), real) || lstatSync(target).isSymbolicLink() || sha256(readFileSync(real)) !== file.sha256) throw new Error('changed');
      }
    } catch { catalogCache = undefined; throw new KnowledgeError('本地产品资料或原图已变化、缺失，请按原任务重新取证策划；历史正文仍可阅读。', 'EVIDENCE_CHANGED', 410); }
  }
}
export function evidenceStatus(e: EvidenceBundle): 'ready' | 'refresh_required' { try { assertEvidenceCurrent(e); return 'ready'; } catch { return 'refresh_required'; } }
export function releaseExpiredMedia() { for (const [id, asset] of assetStore) if ('expiresAt' in asset && (asset.expiresAt <= Date.now() || asset.configuration !== imaConfiguration())) assetStore.delete(id); }
const assetStore = new Map<string, AssetEntry>();
const fileHandles = new Map<string, string>();
const indexDigests = new Map<string, { relative: string; sha256: string }>();
let catalogCache: { root: string; expiresAt: number; entries: CatalogEntry[] } | undefined;
let imaVerification: { kbId: string; kbName: string; verifiedAt: string; configuration: string } | undefined;
let imaMessage = '尚未验证 ima 连接。';
const imaCache = new Map<string, { expiresAt: number; evidence: EvidenceBundle }>();

export class KnowledgeError extends Error {
  constructor(message: string, public code = 'KNOWLEDGE_ERROR', public status = 422) { super(message); this.name = 'KnowledgeError'; }
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const localRoot = () => { const root = path.resolve(process.env.LOCAL_KB_ROOT || path.join(process.cwd(), '华为PC知识库', '华为PC全板块深度知识库_v7')); try { return realpathSync(root); } catch { return root; } };
const normalized = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const within = (base: string, file: string) => { const relative = path.relative(base, file); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };

/** RFC 4180 fields, including BOM, escaped quotes, commas and multiline descriptions. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new KnowledgeError('图片索引 CSV 引号未闭合。', 'INVALID_CSV');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((header, i) => [header.trim(), values[i]?.trim() || ''])));
}

export function detectImageType(data: Buffer): string | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

async function safeFile(root: string, directory: string, file: string): Promise<string> {
  const [realRoot, realDir, realFile] = await Promise.all([realpathAsync(root), realpathAsync(directory), realpathAsync(file)]);
  if (!within(realRoot, realDir) || !within(realDir, realFile)) throw new KnowledgeError('文件不在指定型号的资料目录内。', 'INVALID_ASSET', 404);
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ASSET) throw new KnowledgeError('素材格式或大小不符合要求。', 'INVALID_ASSET', 404);
  return realFile;
}

function publicHuaweiUrl(text: string | undefined): string | undefined {
  try { const url = new URL(text || ''); return url.protocol === 'https:' && url.hostname === 'consumer.huawei.com' && !url.username && !url.password ? url.toString() : undefined; } catch { return undefined; }
}

function sections(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const matches = [...text.replace(/\r\n/g, '\n').matchAll(/^##\s+([^\n]+)\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/gm)];
  for (const match of matches) result.set(match[1].trim(), match[2].trim());
  return result;
}

/** Extract concise claims only from official specification chapters; keep full chapters for review. */
export function extractFacts(text: string, product: Product, sourceMode: KnowledgeSource, retrievedAt: string, sourceTitle = `${product.name} · 产品事实`): Fact[] {
  const chapters = sections(text);
  const url = publicHuaweiUrl(text.match(/规格页[：:]\s*(https:\/\/\S+)/)?.[1]) || publicHuaweiUrl(text.match(/产品页[：:]\s*(https:\/\/\S+)/)?.[1]);
  const labels = new Set(['宽度','深度','高度','重量','尺寸','类型','屏占比','屏幕比例','分辨率','刷新率','亮度','峰值亮度','色域','色准','色深','对比度','触摸屏','材料','容量','WLAN','蓝牙']);
  const field = (raw: string, label: string) => {
    const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean); const start = lines.indexOf(label);
    if (start < 0) return '';
    const values: string[] = [];
    for (const line of lines.slice(start + 1)) { if (labels.has(line) || /^\*/.test(line)) break; values.push(line); }
    return values.join('；');
  };
  const nonNotes = (raw: string) => raw.split(/\n+/).map(line => line.trim()).filter(line => line && !/^\*/.test(line)).join('；');
  const selections: { chapter: string; describe: (raw: string) => string }[] = [
    { chapter: '操作系统', describe: raw => `操作系统版本：${nonNotes(raw)}` },
    { chapter: '尺寸与重量', describe: raw => field(raw, '重量') ? `机身重量：${field(raw, '重量')}。实际重量依配置和测量方法而异。` : '' },
    { chapter: '屏幕', describe: raw => ['尺寸', '类型', '分辨率'].map(label => field(raw, label) ? `${label}：${field(raw, label)}` : '').join('；') },
    { chapter: '特色应用', describe: raw => {
      const apps = raw.split(/\n+/).map(line => line.trim()).filter(line => line && !/^\*|^(仅|需|使用|实际)/.test(line) && !line.includes('。')).flatMap(line => line.split('、')).map(line => line.replace(/\*+$/, '')).filter(line => line.length < 60).slice(0, 5);
      const restrictions = [raw.includes('仅限 Windows') ? '仅 Windows 版本支持' : '', /部分电脑管家/.test(raw) ? '需符合电脑管家与设备版本条件' : '', /联网/.test(raw) ? '部分功能需联网' : '', /付费/.test(raw) ? '部分功能可能需付费' : ''].filter(Boolean);
      return apps.length ? `特色应用包含：${apps.join('、')}。${restrictions.length ? restrictions.join('，') + '。' : ''}功能适用条件以具体版本为准。` : '';
    } },
    { chapter: '处理器', describe: raw => {
      const options: string[] = [];
      for (const line of raw.split(/\n+/).map(value => value.trim()).filter(Boolean)) {
        if (/^\*/.test(line) && options.length) options[options.length - 1] += `（${line.replace(/^\*+/, '')}）`;
        else options.push(line);
      }
      return `处理器选项：${options.join('；')}`;
    } },
    { chapter: '内存', describe: raw => `内存配置选项：${nonNotes(raw)}。具体组合以销售版本为准。` },
    { chapter: '存储', describe: raw => `存储配置选项：${nonNotes(raw)}。格式化后的实际容量可能较小。` },
    { chapter: '电池', describe: raw => field(raw, '容量') ? `电池容量：${field(raw, '容量')}` : `电池规格：${nonNotes(raw)}` },
    { chapter: '接口', describe: raw => { const lines = raw.split(/\n+/).map(line => line.trim()).filter(line => line && !/^\*/.test(line)); const port = lines.find(line => /USB|雷电|HDMI|耳机/.test(line)); return port ? `接口信息：${port}。接口与功能适用条件请核对具体版本。` : ''; } },
    { chapter: '键盘和触控板', describe: raw => { const lines = raw.split(/\n+/).map(line => line.trim()).filter(line => line && !/^\*/.test(line)); return `键盘与触控板：${lines.slice(0, 2).join('；')}`; } },
  ];
  const facts: Fact[] = [];
  for (const { chapter: title, describe } of selections) {
    const raw = chapters.get(title)?.split(/即将离开consumer\.huawei\.com|您即将跳转至第三方页面/)[0].trim();
    if (!raw || raw.length > 14_000 || /价格|补贴|到手价/.test(title)) continue;
    const lines = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const notes = lines.filter(s => /^\*|^(仅|需|使用该功能)|依配置|因.*不同|以.*为准/.test(s));
    const statement = describe(raw);
    // Never cut a claim mid-sentence: omit unexpectedly long or unparsable values instead.
    if (!statement || statement.length > 350) continue;
    facts.push({ id: `fact-${hash(product.id + title + raw)}`, statement,
      quote: `## ${title}\n\n${raw}`, sourceTitle, sourceUrl: url, retrievedAt,
      qualifiers: [SKU_NOTE, ...notes.map(s => s.replace(/^\*+/, ''))], sourceMode,
      status: 'supported' });
  }
  return facts;
}

async function localImages(root: string, directory: string, product: Product, signal?: AbortSignal): Promise<ImageAsset[]> {
  signal?.throwIfAborted();
  let csv: string;
  try { csv = await fs.readFile(await safeFile(root, directory, path.join(directory, '图片索引.csv')), 'utf8'); } catch { return []; }
  indexDigests.set(directory, { relative: path.relative(root, path.join(directory, '图片索引.csv')), sha256: sha256(csv) });
  const images: ImageAsset[] = [];
  const seen = new Set<string>();
  for (const row of parseCsv(csv).slice(0, 100)) {
    signal?.throwIfAborted();
    const filename = row['文件名'];
    // CSV is data, never a filesystem instruction. No paths, even relative paths, are accepted.
    if (!filename || filename !== path.basename(filename) || /[\\/\x00]/.test(filename) || filename === '..' || seen.has(filename)) continue;
    const model = normalized(row['产品型号'] || '');
    if (model && model !== normalized(product.name) && model !== normalized(path.basename(directory))) continue;
    try {
      const file = await safeFile(root, directory, path.join(directory, 'images', filename));
      const data = await fs.readFile(file); const contentType = detectImageType(data);
      signal?.throwIfAborted();
      if (!contentType) continue;
      seen.add(filename);
      const digest = sha256(data); let handle = fileHandles.get(file);
      const old = handle ? assetStore.get(handle) : undefined;
      if (!old || !('file' in old) || old.sha256 !== digest) {
        handle = randomUUID();
        stateStore().set<SavedAsset>('knowledgeAssets', handle, { kind: 'local', root, relativeFile: path.relative(root, file), relativeDirectory: path.relative(root, directory), contentType, sha256: digest });
        fileHandles.set(file, handle); assetStore.set(handle, { file, directory, root, contentType, sha256: digest });
      }
      images.push({ id: `image-${hash(product.id + filename)}`, name: filename, url: `/api/assets/${handle}`, productId: product.id,
        description: row['官网图片说明'] || filename.replace(/\.[^.]+$/, '').split('_').slice(2, 3).join('') || '产品图片，请按画面选择用途',
        sourceTitle: `${product.name} · 图片索引`, sourceUrl: publicHuaweiUrl(row['来源页面']),
        width: Math.max(0, Number(row['宽度']) || 0), height: Math.max(0, Number(row['高度']) || 0), sourceMode: 'local' });
    } catch { signal?.throwIfAborted(); /* A broken or unsafe image cannot enter the evidence bundle. */ }
  }
  return images;
}

async function catalog(signal?: AbortSignal): Promise<CatalogEntry[]> {
  await restoreAssets();
  signal?.throwIfAborted();
  const root = localRoot();
  if (catalogCache?.root === root && catalogCache.expiresAt > Date.now()) return catalogCache.entries;
  const entries: CatalogEntry[] = [];
  for (const category of ['01-鸿蒙电脑', '02-MateBook-Windows']) {
    const base = path.join(root, 'P1-产品参数库', category);
    let directories; try { directories = await fs.readdir(base, { withFileTypes: true }); } catch { continue; }
    for (const dirent of directories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      signal?.throwIfAborted();
      if (!dirent.isDirectory() || dirent.isSymbolicLink()) continue;
      const directory = path.join(base, dirent.name);
      try {
        const text = await fs.readFile(await safeFile(root, directory, path.join(directory, '产品事实.md')), 'utf8');
        const name = text.match(/^#\s+(.+?)\s*[-—|｜]\s*产品事实/m)?.[1]?.trim() || dirent.name;
        const chapter = sections(text);
        const system = chapter.get('操作系统')?.split(/\n+/).filter(Boolean).join(' / ') || (category.includes('鸿蒙') ? 'HarmonyOS' : 'Windows / Linux（按版本）');
        const product: Product = { id: `pc-${hash(`${category}/${dirent.name}`)}`, name, system,
          category: category.includes('鸿蒙') ? '鸿蒙电脑' : 'MateBook 电脑', description: category.includes('鸿蒙') ? '鸿蒙生态 · 智慧协同' : '专业效率 · 多场景办公', imageCount: 0 };
        const images = await localImages(root, directory, product, signal); product.imageCount = images.length; product.coverUrl = images[0]?.url;
        const sourceFiles = [{ relative: path.relative(root, path.join(directory, '产品事实.md')), sha256: sha256(text) }];
        const index = indexDigests.get(directory); if (index) sourceFiles.push(index);
        for (const image of images) { const asset = assetStore.get(image.url.split('/').pop()!); if (asset && 'file' in asset) sourceFiles.push({ relative: path.relative(root, asset.file), sha256: asset.sha256 }); }
        entries.push({ product, directory, root, text, folderName: dirent.name, images, hasLocal: true, sourceFiles });
      } catch { signal?.throwIfAborted(); /* Missing model files do not take down the complete catalog. */ }
    }
  }
  // Put the newest Pro model first for a useful out-of-the-box demo.
  entries.sort((a, b) => Number(/Pro S$/.test(b.product.name)) - Number(/Pro S$/.test(a.product.name)));
  if (!entries.length) {
    // Public names are a navigation catalog, never a substitute for unavailable source material.
    // A clean clone can choose a model and read its facts and assets from the authorized ima library.
    entries.push(...catalogSeed.map(({ folderName, ...metadata }) => ({
      product: { ...metadata, description: '公开产品目录 · 产品事实与图片需从 ima 读取', imageCount: 0 },
      directory: '', root, text: '', folderName, images: [], hasLocal: false,
    })));
  }
  signal?.throwIfAborted();
  catalogCache = { root, expiresAt: Date.now() + TTL, entries }; return entries;
}

export async function listProducts(): Promise<Product[]> { return (await catalog()).map(item => ({ ...item.product })); }
export async function getLocalStats() {
  const localEntries = (await catalog()).filter(entry => entry.hasLocal);
  return { available: localEntries.length > 0, productCount: localEntries.length, imageCount: localEntries.reduce((n, entry) => n + entry.images.length, 0) };
}

export async function getAsset(handle: string): Promise<{ data: Buffer; contentType: string }> {
  await restoreAssets();
  if (!/^[0-9a-f-]{36}$/i.test(handle)) throw new KnowledgeError('图片不存在或已过期。', 'ASSET_NOT_FOUND', 404);
  const asset = assetStore.get(handle);
  if (!asset) throw new KnowledgeError('图片不存在或已过期。', 'ASSET_NOT_FOUND', 404);
  if ('data' in asset) {
    if (asset.expiresAt < Date.now() || asset.configuration !== imaConfiguration()) { assetStore.delete(handle); throw new KnowledgeError('图片已过期或知识库接入已变化，请重新生成。', 'ASSET_NOT_FOUND', 404); }
    return { data: asset.data, contentType: asset.contentType };
  }
  try {
    const data = await fs.readFile(await safeFile(asset.root, asset.directory, asset.file));
    const contentType = detectImageType(data); if (!contentType || asset.root !== localRoot() || sha256(data) !== asset.sha256) throw new Error('signature');
    return { data, contentType };
  } catch { throw new KnowledgeError('图片不存在或未通过文件校验。', 'ASSET_NOT_FOUND', 404); }
}

function credentialsConfigured() {
  const read = (filename: string) => { try { return readFileSync(path.join(os.homedir(), '.config', 'ima', filename), 'utf8').trim().length > 0; } catch { return false; } };
  return Boolean((process.env.IMA_CLIENT_ID || process.env.IMA_OPENAPI_CLIENTID || read('client_id')) && (process.env.IMA_API_KEY || process.env.IMA_OPENAPI_APIKEY || read('api_key')));
}
const kbName = () => process.env.IMA_KB_NAME?.trim() || DEFAULT_KB;
// A digest invalidates validation and evidence when credentials change; the credentials themselves never leave the server.
const imaConfiguration = () => {
  const read = (name: string) => { try { return readFileSync(path.join(os.homedir(), '.config', 'ima', name), 'utf8').trim(); } catch { return ''; } };
  return sha256([kbName(), process.env.IMA_CLIENT_ID || process.env.IMA_OPENAPI_CLIENTID || read('client_id'), process.env.IMA_API_KEY || process.env.IMA_OPENAPI_APIKEY || read('api_key')].join('|'));
};
export function getImaStatus() {
  const configured = credentialsConfigured();
  const verified = Boolean(configured && imaVerification?.configuration === imaConfiguration() && Date.now() - Date.parse(imaVerification.verifiedAt) < TTL);
  return { configured, verified, kbName: kbName(), accountLabel: process.env.IMA_ACCOUNT_LABEL || '赛事 ima 知识库',
    message: !configured ? '未配置 ima 凭证；可先使用本地知识库演示。' : verified ? `已验证共享知识库「${kbName()}」。` : imaMessage,
    ...(verified && imaVerification ? { verifiedAt: imaVerification.verifiedAt } : {}) };
}

async function imaApi(route: string, body: JsonRecord, signal?: AbortSignal): Promise<JsonRecord> {
  signal?.throwIfAborted();
  if (!credentialsConfigured()) throw new KnowledgeError('未配置 ima 凭证，请在后端环境变量中设置 Client ID 和 API Key。', 'IMA_NOT_CONFIGURED', 503);
  const script = path.resolve(process.env.IMA_SKILL_PATH || path.join(process.cwd(), 'ima-skill', 'ima_api.cjs'));
  if (!existsSync(script)) throw new KnowledgeError('缺少官方 ima-skill 脚本，无法连接知识库。', 'IMA_SKILL_MISSING', 503);
  let stdout: string;
  try {
    const result = await execFileAsync(process.execPath, [script, route, JSON.stringify(body)], { timeout: 35_000, maxBuffer: 8 * 1024 * 1024, signal,
      windowsHide: true, env: { ...process.env, IMA_BASE_URL: 'https://ima.qq.com', IMA_LAST_CHECK_FILE: path.join(process.cwd(), '.cache', 'ima-last-update-check') } }); stdout = result.stdout;
  } catch (error) {
    signal?.throwIfAborted();
    const details = error as { stderr?: string; killed?: boolean }; let reason = 'ima 请求失败，请检查网络和凭证。'; let code = 'IMA_REQUEST_FAILED';
    try { const parsed = JSON.parse(details.stderr || '{}'); if (parsed.code === -200) { reason = '官方 ima-skill 有新版本，原请求未发送，请先更新本地 skill。'; code = 'IMA_SKILL_UPDATE_REQUIRED'; }
      else if (typeof parsed.msg === 'string') reason = redactMessage(parsed.msg); } catch { /* Never surface command lines or environment values. */ }
    if (details.killed) reason = 'ima 请求超时，请重试。';
    throw new KnowledgeError(reason, code, 502);
  }
  signal?.throwIfAborted();
  let response: JsonRecord; try { response = JSON.parse(stdout); } catch { throw new KnowledgeError('ima 返回了不可解析的响应。', 'IMA_INVALID_RESPONSE', 502); }
  if (response.code !== 0) throw new KnowledgeError(redactMessage(String(response.msg || 'ima 业务请求失败。')), `IMA_${String(response.code)}`, 502);
  return response.data || {};
}

function redactMessage(text: string): string {
  for (const value of [process.env.IMA_API_KEY, process.env.IMA_OPENAPI_APIKEY, process.env.IMA_CLIENT_ID, process.env.IMA_OPENAPI_CLIENTID]) if (value) text = text.split(value).join('[已隐藏]');
  return text.replace(/https?:\/\/\S+/g, '[服务地址]').slice(0, 500);
}

async function pages(route: string, body: JsonRecord, keys: string[], maxPages = 6, signal?: AbortSignal): Promise<JsonRecord[]> {
  const result: JsonRecord[] = []; let cursor = ''; const visited = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const data = await imaApi(route, { ...body, cursor }, signal);
    for (const key of keys) if (Array.isArray(data[key])) result.push(...data[key]);
    if (data.is_end === true || !data.next_cursor || visited.has(String(data.next_cursor))) return result;
    cursor = String(data.next_cursor); visited.add(cursor);
  }
  throw new KnowledgeError('ima 目录过大，已达到本次检索上限。请缩小共享知识库目录后重试。', 'IMA_SEARCH_LIMIT');
}

export async function verifyIma(signal?: AbortSignal): Promise<{ kbName: string; verifiedAt: string }> {
  signal?.throwIfAborted();
  try {
    const entries = await pages('openapi/wiki/v1/search_knowledge_base', { query: kbName(), limit: 20 }, ['info_list', 'knowledge_base_list'], 6, signal);
    const matches = entries.filter(item => normalized(String(item.kb_name || item.name || '')) === normalized(kbName()));
    const unique = [...new Map(matches.map(item => [String(item.kb_id || item.id || ''), item])).values()].filter(item => item.kb_id || item.id);
    if (unique.length !== 1) throw new KnowledgeError(unique.length ? '存在多个同名 ima 知识库，请为目标库设置唯一名称。' : `未找到共享知识库「${kbName()}」，请检查共享权限和库名。`, 'IMA_KB_NOT_FOUND');
    const id = String(unique[0].kb_id || unique[0].id);
    await imaApi('openapi/wiki/v1/get_knowledge_base', { ids: [id] }, signal);
    signal?.throwIfAborted();
    imaVerification = { kbId: id, kbName: kbName(), verifiedAt: new Date().toISOString(), configuration: imaConfiguration() };
    imaMessage = '共享知识库连接已验证。';
    return { kbName: imaVerification.kbName, verifiedAt: imaVerification.verifiedAt };
  } catch (error) { signal?.throwIfAborted(); imaVerification = undefined; imaMessage = error instanceof Error ? error.message : 'ima 验证失败。'; throw error; }
}

const itemTitle = (item: JsonRecord) => String(item.title || item.name || item.folder_info?.name || '');
const itemId = (item: JsonRecord) => String(item.folder_id || item.media_id || item.id || item.folder_info?.folder_id || '');
const listFolder = (id: string, folderId?: string, signal?: AbortSignal) => pages('openapi/wiki/v1/get_knowledge_list', { knowledge_base_id: id, ...(folderId ? { folder_id: folderId } : {}), limit: 50 }, ['knowledge_list', 'folder_list'], 6, signal);

async function findModelFolder(id: string, entry: CatalogEntry, signal?: AbortSignal): Promise<{ folderId: string; items: JsonRecord[] }> {
  signal?.throwIfAborted();
  const aliases = new Set([normalized(entry.folderName), normalized(entry.product.name)]);
  const search = await pages('openapi/wiki/v1/search_knowledge', { knowledge_base_id: id, query: entry.folderName }, ['info_list'], 6, signal);
  const candidates = search.filter(item => aliases.has(normalized(itemTitle(item))) && itemId(item));
  if (candidates.length === 1) {
    const folderId = itemId(candidates[0]); const items = await listFolder(id, folderId, signal);
    if (items.some(item => /^产品事实(?:\.md)?$/.test(itemTitle(item)))) return { folderId, items };
  }
  // Search can omit folders. Traverse only structural branches and exact model names, never arbitrary unrelated folders.
  const queue: { folderId?: string; depth: number }[] = [{ depth: 0 }]; const visited = new Set<string>(); let reads = 0;
  while (queue.length && reads++ < 20) {
    signal?.throwIfAborted();
    const current = queue.shift()!; const items = await listFolder(id, current.folderId, signal);
    const exact = items.filter(item => aliases.has(normalized(itemTitle(item))) && itemId(item));
    if (exact.length > 1) throw new KnowledgeError('ima 中存在多个同名产品目录，无法确定型号来源。', 'IMA_MODEL_AMBIGUOUS');
    if (exact.length === 1) { const folderId = itemId(exact[0]); return { folderId, items: await listFolder(id, folderId, signal) }; }
    for (const item of items) {
      const title = itemTitle(item); const folderId = itemId(item);
      const structural = /^(P1[-－]|0[12][－-]|华为PC全板块深度知识库|华为PC知识库)/.test(title)
        || (current.depth === 0 && normalized(title) === normalized(kbName()));
      if (current.depth < 4 && folderId && !visited.has(folderId) && structural) { visited.add(folderId); queue.push({ folderId, depth: current.depth + 1 }); }
    }
  }
  throw new KnowledgeError(`ima 搜索及目录回退均未找到「${entry.product.name}」的独立产品目录；不会使用相近型号代替。`, 'IMA_MODEL_NOT_FOUND');
}

function allowedMediaUrl(raw: string): URL {
  let url: URL; try { url = new URL(raw); } catch { throw new KnowledgeError('ima 原文地址无效，请使用 ima 客户端查看原文。', 'IMA_MEDIA_UNAVAILABLE'); }
  const host = url.hostname.toLowerCase();
  const allowed = host === 'ima.qq.com' || host.endsWith('.myqcloud.com') || host === 'consumer.huawei.com';
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || (url.port && url.port !== '443')) throw new KnowledgeError('ima 返回的原文域名不在支持范围，请使用 ima 客户端查看原文。', 'IMA_MEDIA_UNAVAILABLE');
  return url;
}

async function fetchMedia(urlInfo: JsonRecord, maxBytes: number, signal?: AbortSignal): Promise<{ data: Buffer; contentType: string }> {
  signal?.throwIfAborted();
  const url = allowedMediaUrl(String(urlInfo.url || ''));
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(urlInfo.headers || {})) {
    if (typeof value !== 'string' || /^(host|cookie|ima-openapi-clientid|ima-openapi-apikey|proxy-authorization)$/i.test(key)) continue;
    headers[key] = value;
  }
  let response: Response;
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  try { response = await fetch(url, { headers, redirect: 'error', signal: requestSignal }); }
  catch { signal?.throwIfAborted(); throw new KnowledgeError('ima 原文请求失败，请使用 ima 客户端查看原文。', 'IMA_MEDIA_UNAVAILABLE', 502); }
  if (!response.ok) throw new KnowledgeError('ima 原文无权读取或已过期，请使用 ima 客户端查看原文。', 'IMA_MEDIA_UNAVAILABLE', 502);
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > maxBytes) throw new KnowledgeError('ima 原文超过本 Demo 的读取上限。', 'IMA_MEDIA_TOO_LARGE');
  const reader = response.body?.getReader(); if (!reader) throw new KnowledgeError('ima 原文内容为空。', 'IMA_MEDIA_UNAVAILABLE');
  const chunks: Buffer[] = []; let length = 0;
  try { while (true) { signal?.throwIfAborted(); const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maxBytes) { await reader.cancel(); throw new KnowledgeError('ima 原文超过本 Demo 的读取上限。', 'IMA_MEDIA_TOO_LARGE'); } chunks.push(Buffer.from(value)); } }
  finally { reader.releaseLock(); }
  return { data: Buffer.concat(chunks), contentType: response.headers.get('content-type') || '' };
}

async function readImaItem(item: JsonRecord, signal?: AbortSignal): Promise<{ data: Buffer; contentType: string }> {
  signal?.throwIfAborted();
  const mediaId = itemId(item); if (!mediaId) throw new KnowledgeError('ima 条目没有可读取的原文。', 'IMA_MEDIA_UNAVAILABLE');
  const info = await imaApi('openapi/wiki/v1/get_media_info', { media_id: mediaId }, signal);
  if (Number(info.media_type) === 11 && info.notebook_ext_info?.notebook_id) {
    const doc = await imaApi('openapi/note/v1/get_doc_content', { note_id: info.notebook_ext_info.notebook_id, target_content_format: 0 }, signal);
    if (typeof doc.content !== 'string' || doc.content.length > 1_000_000) throw new KnowledgeError('ima 笔记原文为空或超过读取上限。', 'IMA_MEDIA_UNAVAILABLE');
    return { data: Buffer.from(doc.content), contentType: 'text/plain' };
  }
  if (!info.url_info?.url) throw new KnowledgeError('ima 未提供可读取的原文，请使用 ima 客户端查看原文。', 'IMA_MEDIA_UNAVAILABLE');
  return fetchMedia(info.url_info, Number(info.media_type) === 9 ? MAX_ASSET : 2 * 1024 * 1024, signal);
}

function decodeText(data: Buffer, contentType: string, title: string): string {
  if (data.subarray(0, 4).toString() === '%PDF' || /^PK/.test(data.subarray(0, 2).toString())) throw new KnowledgeError('该 ima 原文为 PDF 或 Office 文件；首版只支持 Markdown、TXT、HTML 或笔记原文，请在库中提供产品事实文本。', 'IMA_UNSUPPORTED_DOCUMENT');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  if (contentType.includes('text/html') || /<html/i.test(text)) return text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n## $1\n').replace(/<\/(?:p|div|li|tr)>|<br\s*\/?\s*>/gi, '\n\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (!/\.(?:md|txt|csv)$/i.test(title) && contentType && !/text|markdown|csv|octet-stream/i.test(contentType)) throw new KnowledgeError('ima 原文格式暂不支持，请在库中提供产品事实 Markdown。', 'IMA_UNSUPPORTED_DOCUMENT');
  return text;
}

async function imaEvidence(entry: CatalogEntry, signal?: AbortSignal): Promise<EvidenceBundle> {
  signal?.throwIfAborted();
  const key = `${imaConfiguration()}:${entry.product.id}`; const cached = imaCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.evidence);
  if (!getImaStatus().verified) await verifyIma(signal);
  const { items } = await findModelFolder(imaVerification!.kbId, entry, signal);
  const factItems = items.filter(item => /^产品事实(?:\.md)?$/.test(itemTitle(item)));
  if (factItems.length !== 1) throw new KnowledgeError('产品目录缺少唯一的「产品事实.md」，无法建立可信证据包。', 'IMA_FACTS_NOT_FOUND');
  const original = await readImaItem(factItems[0], signal); const text = decodeText(original.data, original.contentType, itemTitle(factItems[0]));
  const originalName = text.match(/^#\s+(.+?)\s*[-—|｜]\s*产品事实/m)?.[1]?.trim();
  if (!originalName || normalized(originalName) !== normalized(entry.product.name)) throw new KnowledgeError('ima 原文型号与选择的产品不一致，已停止生成。', 'IMA_MODEL_MISMATCH');
  const retrievedAt = new Date().toISOString(); const sourceTitle = `${kbName()} / ${entry.product.name} / 产品事实`;
  const facts = extractFacts(text, entry.product, 'ima', retrievedAt, sourceTitle);
  if (facts.length < 3) throw new KnowledgeError('ima 原文中可确认的产品规格不足，请补充带章节的产品事实原文。', 'IMA_FACTS_INSUFFICIENT');
  const warnings: string[] = ['已读取 ima 原文；共享知识库内容仍应在发布前与实际销售 SKU 核对。'];
  const images: ImageAsset[] = [];
  const stagedAssets: { handle: string; data: Buffer; contentType: string }[] = [];
  const indexItems = items.filter(item => /^图片索引(?:\.csv)?$/.test(itemTitle(item)));
  if (indexItems.length === 1) {
    const index = await readImaItem(indexItems[0], signal); const rows = parseCsv(decodeText(index.data, index.contentType, '图片索引.csv'));
    let imageItems = items.filter(item => /\.(?:png|jpe?g|webp)$/i.test(itemTitle(item)));
    const imageFolders = items.filter(item => /^images$/i.test(itemTitle(item)));
    if (imageFolders.length === 1) imageItems = imageItems.concat(await listFolder(imaVerification!.kbId, itemId(imageFolders[0]), signal));
    for (const row of rows.slice(0, 10)) {
      signal?.throwIfAborted();
      const filename = row['文件名']; const model = normalized(row['产品型号'] || '');
      if (!filename || /[\\/\x00]/.test(filename) || (model && model !== normalized(entry.product.name) && model !== normalized(entry.folderName))) continue;
      const imageItem = imageItems.find(item => itemTitle(item) === filename); if (!imageItem) continue;
      const media = await readImaItem(imageItem, signal); const contentType = detectImageType(media.data);
      if (!contentType) throw new KnowledgeError('ima 图片原文未通过真实格式校验，已停止使用该证据包。', 'IMA_INVALID_IMAGE');
      const handle = randomUUID(); stagedAssets.push({ handle, data: media.data, contentType });
      images.push({ id: `image-${hash(entry.product.id + filename)}`, name: filename, url: `/api/assets/${handle}`, productId: entry.product.id,
        description: row['官网图片说明'] || filename, sourceTitle: `${kbName()} / ${entry.product.name} / 图片索引`, sourceUrl: publicHuaweiUrl(row['来源页面']),
        width: Number(row['宽度']) || 0, height: Number(row['高度']) || 0, sourceMode: 'ima' });
    }
  }
  if (!images.length) warnings.push('ima 中未取得与本型号图片索引对应的真实图片；没有用本地图片替代。');
  const originalSystem = sections(text).get('操作系统')?.split(/\n+/).filter(Boolean).join(' / ');
  const evidence: EvidenceBundle = { product: { ...entry.product, ...(originalSystem ? { system: originalSystem } : {}), imageCount: images.length, coverUrl: images[0]?.url }, facts, images,
    sources: [{ id: `source-${hash(sourceTitle)}`, title: sourceTitle, text: facts.map(fact => fact.quote).join('\n\n'), retrievedAt, sourceMode: 'ima' }], retrievedAt, sourceMode: 'ima', warnings };
  signal?.throwIfAborted();
  await fs.mkdir(path.join(stateDirectory(), 'media'), { recursive: true, mode: 0o700 });
  const configuration = imaConfiguration(); const expiresAt = Date.parse(retrievedAt) + TTL;
  for (const asset of stagedAssets) {
    await fs.writeFile(path.join(stateDirectory(), 'media', asset.handle), asset.data, { mode: 0o600 });
    stateStore().set<SavedAsset>('knowledgeAssets', asset.handle, { kind: 'ima', contentType: asset.contentType, expiresAt, configuration });
    assetStore.set(asset.handle, { data: asset.data, contentType: asset.contentType, expiresAt, configuration });
  }
  rememberEvidenceBinding(evidence, { source: 'ima', configuration });
  for (const [cacheKey, value] of imaCache) if (value.expiresAt < Date.now()) imaCache.delete(cacheKey);
  for (const [handle, value] of assetStore) if ('expiresAt' in value && value.expiresAt < Date.now()) assetStore.delete(handle);
  imaCache.set(key, { expiresAt: Date.now() + TTL, evidence }); return structuredClone(evidence);
}

export async function getEvidence(productId: string, source: KnowledgeSource, signal?: AbortSignal): Promise<EvidenceBundle> {
  signal?.throwIfAborted();
  if (source === 'local') catalogCache = undefined;
  const entry = (await catalog(signal)).find(item => item.product.id === productId);
  signal?.throwIfAborted();
  if (!entry) throw new KnowledgeError('未找到该产品，请从产品列表重新选择。', 'PRODUCT_NOT_FOUND', 404);
  if (source === 'ima') return imaEvidence(entry, signal);
  if (source !== 'local') throw new KnowledgeError('不支持的知识来源。', 'INVALID_SOURCE', 400);
  if (!entry.hasLocal) throw new KnowledgeError('本地知识库未安装；产品列表仅为公开目录元数据，不包含可用事实或图片。请连接 ima 后选择模型创作，或配置 LOCAL_KB_ROOT。', 'LOCAL_KB_UNAVAILABLE', 503);
  const retrievedAt = new Date().toISOString(); const title = `${entry.product.name} · 产品事实（本地资料）`;
  const facts = extractFacts(entry.text, entry.product, 'local', retrievedAt, title);
  signal?.throwIfAborted();
  if (facts.length < 3) throw new KnowledgeError('本地产品事实不足，无法生成有依据的内容。', 'FACTS_INSUFFICIENT');
  const evidence: EvidenceBundle = { product: { ...entry.product }, facts, images: entry.images.map(image => ({ ...image })),
    sources: [{ id: `source-${hash(entry.product.id)}`, title, text: facts.map(fact => fact.quote).join('\n\n'), retrievedAt, sourceMode: 'local' },
      { id: `source-${hash(entry.product.id + 'images')}`, title: `${entry.product.name} · 图片索引（本地资料）`, retrievedAt, sourceMode: 'local' }],
    retrievedAt, sourceMode: 'local', warnings: ['当前依据来自本地知识库快照，未通过 ima 在线检索或实时官网复核，不能视为当前销售配置的确认。', SKU_NOTE] };
  rememberEvidenceBinding(evidence, { source: 'local', root: entry.root, files: entry.sourceFiles });
  assertEvidenceCurrent(evidence);
  return evidence;
}
