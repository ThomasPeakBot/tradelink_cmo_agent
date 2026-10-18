import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
  sync: vi.fn(),
  alerts: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  currentUser: async () => mocks.user,
  assertOrigin: (request: Request) => {
    if (request.headers.get('origin') !== 'http://localhost') throw Error('INVALID_ORIGIN');
  },
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/social-sync', () => ({ syncSocial: mocks.sync }));
vi.mock('@/lib/alerts', () => ({ refreshAlerts: mocks.alerts }));
import { POST, GET } from '../app/api/[resource]/route';
const context = { params: Promise.resolve({ resource: 'social-sync' }) };
const request = (provider = 'x', origin = 'http://localhost') =>
  new Request('http://localhost/api/social-sync', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' };
});
it('requires login, administrator role and trusted origin before any social request', async () => {
  mocks.user = null;
  expect((await POST(request(), context)).status).toBe(401);
  mocks.user = { id: 'viewer', email: 'viewer@example.invalid', role: 'VIEWER' };
  expect((await POST(request(), context)).status).toBe(403);
  mocks.user.role = 'ADMIN';
  expect((await POST(request('x', 'https://attacker.invalid'), context)).status).toBe(403);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('rejects unknown providers and does not sync on GET', async () => {
  expect((await POST(request('unknown'), context)).status).toBe(400);
  expect((await GET(request(), context)).status).toBe(404);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('syncs only the explicitly selected platform', async () => {
  expect((await POST(request('instagram'), context)).status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledWith('admin@example.invalid', 'instagram');
});
