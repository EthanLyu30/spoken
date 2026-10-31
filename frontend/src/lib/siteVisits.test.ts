import { afterEach, expect, it, vi } from 'vitest';
import { recordSiteVisit } from './siteVisits';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('reports a guest identity without page, timestamp, content or identity in the body', async () => {
  localStorage.setItem('spoken-client-id', 'test-browser');
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await recordSiteVisit();
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toMatch(/\/api\/telemetry\/visit$/);
  expect(options.headers).toEqual({ 'X-Client-Id': 'test-browser' });
  expect(options.method).toBe('POST');
  expect(options.body).toBeUndefined();
  expect(options.keepalive).toBe(true);
});

it('passes the existing session for server-side account classification', async () => {
  localStorage.setItem('spoken-client-id', 'test-browser');
  localStorage.setItem('spoken-token', 'local-test-token');
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await recordSiteVisit();
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer local-test-token');
});

it('never rejects into the page when collection fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(recordSiteVisit()).resolves.toBeUndefined();
});

it('does not turn unavailable device storage into one shared guest', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled'); });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  try { await recordSiteVisit(); expect(fetcher).not.toHaveBeenCalled(); }
  finally { read.mockRestore(); }
});
