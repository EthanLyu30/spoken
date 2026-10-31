import { StrictMode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuth } from '../store/auth';
import { SiteVisitTracker } from './SiteVisitTracker';

afterEach(() => { vi.unstubAllGlobals(); useAuth.setState({ user: null }); localStorage.clear(); });

it.each(['/admin', '/admin/traces'])('does not report private dashboard visits (%s)', async path => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter initialEntries={[path]}><SiteVisitTracker /></MemoryRouter>);
  expect(fetcher).not.toHaveBeenCalled();
});

it('records an initial public visit once under StrictMode and reacts to login', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  render(<StrictMode><MemoryRouter><SiteVisitTracker /></MemoryRouter></StrictMode>);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  localStorage.setItem('spoken-token', 'local-test-token');
  act(() => useAuth.setState({ user: { id: 2, email: 'user@example.com', display_name: '', avatar_url: '', created_at: '', is_admin: false } }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer local-test-token');
});

it('excludes known administrators even on public pages', () => {
  useAuth.setState({ user: { id: 2, email: 'owner@example.com', display_name: '', avatar_url: '', created_at: '', is_admin: true } });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><SiteVisitTracker /></MemoryRouter>);
  expect(fetcher).not.toHaveBeenCalled();
});
