import path from 'node:path';

/** Tests and temporary verification servers must use their own render files as well as state. */
export function renderDirectory() { return path.resolve(process.env.AGENT_RENDER_DIR || '.cache/render'); }
