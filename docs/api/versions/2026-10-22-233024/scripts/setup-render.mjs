import { spawnSync } from 'node:child_process';
import path from 'node:path';
const cli = path.resolve('node_modules/playwright/cli.js');
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', windowsHide: true,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.resolve('.cache/ms-playwright') } });
process.exitCode = result.status || (result.error ? 1 : 0);
