import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'dotenv';

const execute = promisify(execFile);
const client = 'synthetic-ima-client-123';
const key = 'synthetic-ima-api-key-456';
const unrelated = '\ufeff# synthetic configuration\r\nLLM_API_KEY=synthetic-text-key\r\nMULTILINE="first\r\nIMA_API_KEY=synthetic-embedded-key\r\nIMA_OPENAPI_CLIENTID=synthetic-embedded-client\r\nlast"\r\nSINGLE_MULTILINE=\'first\r\nexport IMA_CLIENT_ID=synthetic-embedded-export\r\nlast\'\r\nIMAGE_TIMEOUT_MS=240000\r\n';
const original = unrelated + 'IMA_CLIENT_ID=synthetic-old-client\r\nexport IMA_CLIENT_ID=synthetic-duplicate-client\r\nIMA_OPENAPI_CLIENTID=synthetic-old-client-alias\r\nIMA_API_KEY=synthetic-old-key\r\nexport IMA_API_KEY=synthetic-duplicate-key\r\nIMA_OPENAPI_APIKEY=synthetic-old-key-alias\r\nexport IMA_OPENAPI_APIKEY=synthetic-duplicate-key-alias\r\nIMA_KB_NAME=原有模拟知识库\r\n';

async function fixture(contents: string | null = original) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ima-config-test-'));
  await mkdir(path.join(directory, 'scripts'));
  const script = path.join(directory, 'scripts/configure-ima.py');
  await copyFile(new URL('../scripts/configure-ima.py', import.meta.url), script);
  const env = path.join(directory, '.env.local');
  if (contents !== null) await writeFile(env, contents);
  return { directory, script, env };
}

interface Input {
  client?: string;
  key?: string;
  kb?: string;
  tty?: boolean;
  cancelAt?: 'client' | 'key' | 'kb';
  cancellation?: 'EOFError' | 'KeyboardInterrupt';
}

function run(script: string, options: Input = {}) {
  // Copy the command into a synthetic project and mock only its terminal input.
  // Never read the real project environment file or contact the ima service.
  const input = { client, key, kb: '', tty: true, ...options };
  const code = `import json,runpy,sys\nfrom unittest.mock import patch\nscript,raw=sys.argv[1:]\ndata=json.loads(raw)\nsys.argv=[script]\ncount=0\ndef answer(stage):\n if data.get('cancelAt')==stage:\n  raise {'EOFError':EOFError,'KeyboardInterrupt':KeyboardInterrupt}[data.get('cancellation','EOFError')]()\n return data[stage]\ndef hidden(*args,**kwargs):\n global count\n count+=1\n return answer('client' if count==1 else 'key')\nwith patch('sys.stdin.isatty',return_value=data['tty']),patch('getpass.getpass',side_effect=hidden),patch('builtins.input',side_effect=lambda *args:answer('kb')):\n runpy.run_path(script,run_name='__main__')\n`;
  return execute('python3', ['-c', code, script, JSON.stringify(input)], { timeout: 10_000 });
}

test('ima configuration replaces duplicate credentials and aliases, preserves unrelated bytes, and hides secrets', async () => {
  const f = await fixture();
  try {
    const result = await run(f.script);
    const saved = await readFile(f.env, 'utf8');
    assert.ok(saved.startsWith(unrelated));
    const values = parse(saved);
    assert.equal(values.IMA_CLIENT_ID, client);
    assert.equal(values.IMA_OPENAPI_CLIENTID, client);
    assert.equal(values.IMA_API_KEY, key);
    assert.equal(values.IMA_OPENAPI_APIKEY, key);
    assert.equal(values.MULTILINE, 'first\nIMA_API_KEY=synthetic-embedded-key\nIMA_OPENAPI_CLIENTID=synthetic-embedded-client\nlast');
    assert.equal(values.SINGLE_MULTILINE, 'first\nexport IMA_CLIENT_ID=synthetic-embedded-export\nlast');
    assert.doesNotMatch(saved, /synthetic-(?:old|duplicate)-(?:client|key)/);
    for (const name of ['IMA_CLIENT_ID', 'IMA_OPENAPI_CLIENTID', 'IMA_API_KEY', 'IMA_OPENAPI_APIKEY']) {
      assert.equal(saved.slice(unrelated.length).split('\n').filter(line => line.startsWith(`${name}=`)).length, 1);
    }
    assert.equal((await stat(f.env)).mode & 0o777, 0o600);
    assert.ok(!(result.stdout + result.stderr).includes(client));
    assert.ok(!(result.stdout + result.stderr).includes(key));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('blank knowledge base input preserves existing configuration and a name with Chinese and spaces updates it', async () => {
  const f = await fixture();
  try {
    await run(f.script, { kb: '   ' });
    assert.ok((await readFile(f.env, 'utf8')).includes('IMA_KB_NAME=原有模拟知识库\r\n'));
    await writeFile(f.env, (await readFile(f.env, 'utf8')) + 'export IMA_KB_NAME=重复模拟库\r\n');
    await run(f.script, { kb: '新模拟 知识库' });
    const saved = await readFile(f.env, 'utf8');
    assert.equal(parse(saved).IMA_KB_NAME, '新模拟 知识库');
    assert.equal(saved.split('\n').filter(line => /^(?:export\s+)?IMA_KB_NAME=/.test(line)).length, 1);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('a missing environment file is created privately without overriding the backend knowledge base default', async () => {
  const f = await fixture(null);
  try {
    await run(f.script);
    const saved = await readFile(f.env, 'utf8');
    assert.equal(parse(saved).IMA_CLIENT_ID, client);
    assert.equal(parse(saved).IMA_API_KEY, key);
    assert.equal(parse(saved).IMA_KB_NAME, undefined);
    assert.equal((await stat(f.env)).mode & 0o777, 0o600);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('dotenv parses accepted punctuation in credentials literally', async () => {
  const f = await fixture();
  const specialClient = 'synthetic#client$"quoted"\\path';
  const specialKey = 'synthetic#api$"quoted"\\path\\';
  try {
    const result = await run(f.script, { client: specialClient, key: specialKey });
    const values = parse(await readFile(f.env));
    assert.equal(values.IMA_CLIENT_ID, specialClient);
    assert.equal(values.IMA_OPENAPI_CLIENTID, specialClient);
    assert.equal(values.IMA_API_KEY, specialKey);
    assert.equal(values.IMA_OPENAPI_APIKEY, specialKey);
    assert.ok(!(result.stdout + result.stderr).includes(specialClient));
    assert.ok(!(result.stdout + result.stderr).includes(specialKey));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('an old credential ending in a backslash does not consume the following quoted setting', async () => {
  const preserved = "OTHER_SETTING='preserve-me'\r\n";
  const f = await fixture("IMA_CLIENT_ID='synthetic-old\\'\r\n" + preserved);
  try {
    await run(f.script);
    const saved = await readFile(f.env, 'utf8');
    assert.ok(saved.startsWith(preserved));
    assert.equal(parse(saved).OTHER_SETTING, 'preserve-me');
    assert.equal(parse(saved).IMA_CLIENT_ID, client);
    assert.ok(!saved.includes('synthetic-old'));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('colon-style multiline settings preserve embedded ima assignments', async () => {
  const preserved = 'OTHER_SETTING: "first\r\nIMA_CLIENT_ID=synthetic-embedded-client\r\nIMA_API_KEY=synthetic-embedded-key\r\nlast"\r\n';
  const f = await fixture(preserved + 'IMA_CLIENT_ID=synthetic-old-client\r\nIMA_API_KEY=synthetic-old-key\r\n');
  try {
    await run(f.script);
    const saved = await readFile(f.env, 'utf8');
    assert.ok(saved.startsWith(preserved));
    const values = parse(saved);
    assert.equal(values.OTHER_SETTING, 'first\nIMA_CLIENT_ID=synthetic-embedded-client\nIMA_API_KEY=synthetic-embedded-key\nlast');
    assert.equal(values.IMA_CLIENT_ID, client);
    assert.equal(values.IMA_API_KEY, key);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('invalid or noninteractive input leaves the environment file byte-identical', async () => {
  const f = await fixture();
  const invalid: Input[] = [
    { tty: false }, { client: '' }, { key: '' },
    { client: 'synthetic client' }, { key: 'synthetic\u00a0key' },
    { client: 'synthetic\u0001client' }, { key: 'synthetic\u007fkey' },
    { client: "synthetic'client" }, { key: "synthetic'key" },
    { client: 'replace-with-your-client-id' }, { key: 'your-api-key' },
    { client: 'x'.repeat(301) }, { key: 'x'.repeat(501) },
    { kb: '库'.repeat(121) }, { kb: '模拟\n知识库' }, { kb: "模拟'知识库" },
  ];
  try {
    const before = await readFile(f.env);
    for (const [index, options] of invalid.entries()) {
      await assert.rejects(run(f.script, options), `invalid case ${index} must fail`);
      assert.deepEqual(await readFile(f.env), before, `invalid case ${index} changed the file`);
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('EOF and keyboard cancellation at every prompt preserve original bytes', async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.env);
    for (const cancelAt of ['client', 'key', 'kb'] as const) {
      for (const cancellation of ['EOFError', 'KeyboardInterrupt'] as const) {
        await assert.rejects(run(f.script, { cancelAt, cancellation }));
        assert.deepEqual(await readFile(f.env), before);
      }
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('symbolic environment files are rejected without changing the link or its target', async () => {
  const f = await fixture(null);
  try {
    const target = path.join(f.directory, 'synthetic-target.env');
    await writeFile(target, original);
    await symlink(target, f.env);
    await assert.rejects(run(f.script));
    assert.ok((await lstat(f.env)).isSymbolicLink());
    assert.equal(await readFile(target, 'utf8'), original);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
