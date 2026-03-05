import { vi } from 'vitest';

export function mockFetch(responses: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => {
    const body = responses[url];
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
