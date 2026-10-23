export type Transport = (url: string, init?: RequestInit) => Promise<Response>;
export type MockScenario = 'ok' | 'blocked' | 'needs_input' | 'error' | 'empty' | 'slow' | 'expired' | 'conflict' | 'disconnected' | 'insufficient-images';
const SCENARIOS: readonly MockScenario[] = ['ok', 'blocked', 'needs_input', 'error', 'empty', 'slow', 'expired', 'conflict', 'disconnected', 'insufficient-images'];

/** Query parsing is intentionally independent of the lazy-loaded fixture and rendering data. */
export function mockScenario(search = typeof location === 'undefined' ? '' : location.search): MockScenario | null {
  const value = new URLSearchParams(search).get('mock');
  return value === null ? null : SCENARIOS.includes(value as MockScenario) ? value as MockScenario : 'ok';
}
