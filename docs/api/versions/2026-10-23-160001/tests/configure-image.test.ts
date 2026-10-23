import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ark-config-test-'));
  await mkdir(path.join(directory, 'scripts'));
  const script = path.join(directory, 'scripts/configure-visual.py');
  await copyFile(new URL('../scripts/configure-visual.py', import.meta.url), script);
  const env = path.join(directory, '.env.local');
  const original = '# synthetic configuration\r\nLLM_API_KEY=test-text-unchanged\r\nLLM_MODEL=gpt-6.1-sol\r\nCANVA_CLIENT_SECRET=test-legacy-unchanged\r\nIMAGE_API_KEY=test-old-image-key\r\nexport IMAGE_API_KEY=test-duplicate-image-key\r\nIMAGE_BASE_URL=https://legacy.invalid/v1\r\nIMAGE_MODEL=legacy-test-model\r\nIMAGE_TIMEOUT_MS=240000\r\n';
  await writeFile(env, original);
  return { directory, script, env, original };
}
function run(script: string, key: string, tty = true, service?: string) {
  // Simulate the hidden-input boundary in an isolated synthetic project. The
  // user's actual environment file and real terminal are never read or written.
  const code = `import runpy,sys\nfrom unittest.mock import patch\nsys.argv=[${JSON.stringify(script)}${service ? ',' + JSON.stringify(service) : ''}]\nwith patch('sys.stdin.isatty',return_value=${tty ? 'True' : 'False'}), patch('getpass.getpass',return_value=${JSON.stringify(key)}):\n runpy.run_path(${JSON.stringify(script)},run_name='__main__')\n`;
  return execute('python3', ['-c', code], { timeout: 10_000 });
}

test('image configuration accepts Ark non-sk keys, replaces only image assignments atomically and keeps credentials hidden', async () => {
  const f = await fixture(), key = 'a1234567-b890-c123-d456-123456789abc';
  try {
    const result = await run(f.script, key, true, 'image');
    const saved = await readFile(f.env, 'utf8');
    assert.ok(saved.startsWith('# synthetic configuration\r\nLLM_API_KEY=test-text-unchanged\r\nLLM_MODEL=gpt-6.1-sol\r\nCANVA_CLIENT_SECRET=test-legacy-unchanged\r\n'));
    assert.ok(saved.includes('IMAGE_TIMEOUT_MS=240000\r\n'));
    assert.match(saved, /IMAGE_BASE_URL=https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3\n/);
    assert.match(saved, /IMAGE_MODEL=doubao-seedream-5-0-pro-260628\n/);
    assert.equal(saved.split('\n').filter(line => /^\s*(?:export\s+)?IMAGE_API_KEY=/.test(line)).length, 1);
    assert.ok(saved.includes(`IMAGE_API_KEY=${key}\n`));
    assert.equal((await stat(f.env)).mode & 0o777, 0o600);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(key));
    assert.doesNotMatch(saved, /test-old-image-key|test-duplicate-image-key|legacy\.invalid/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('default credential command configures only Ark images and never prompts for legacy external-design credentials', async () => {
  const f = await fixture();
  try {
    await run(f.script, 'test-ark-default-image-key');
    const saved = await readFile(f.env, 'utf8');
    assert.match(saved, /IMAGE_MODEL=doubao-seedream-5-0-pro-260628/);
    assert.match(saved, /CANVA_CLIENT_SECRET=test-legacy-unchanged/);
    assert.doesNotMatch(saved, /CANVA_CLIENT_ID=|CANVA_REDIRECT_URI=/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('example, unsafe or noninteractive image input leaves the original file byte-identical', async () => {
  const f = await fixture();
  try {
    for (const [key, tty] of [['sk-your-api-key', true], ['replace-with-your-api-key', true], ['test-key-with-#-comment', true], ['x'.repeat(24), true], ['test-ark-valid-image-key', false]] as const) {
      await assert.rejects(run(f.script, key, tty, 'image'));
      assert.equal(await readFile(f.env, 'utf8'), f.original);
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
