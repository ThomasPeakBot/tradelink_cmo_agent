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
vi.mock('@/lib/x-ads-sync', () => ({ syncXAds: mocks.sync }));
vi.mock('@/lib/alerts', () => ({ refreshAlerts: mocks.alerts }));
import { POST, GET } from '../app/api/[resource]/route';
const context = { params: Promise.resolve({ resource: 'x-ads-sync' }) };
const request = (extra = false, origin = 'http://localhost') =>
  new Request('http://localhost/api/x-ads-sync', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(extra ? { unexpected: true } : {}),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' };
});
it('requires login, administrator role and trusted origin before any paid ads request', async () => {
  mocks.user = null;
  expect((await POST(request(), context)).status).toBe(401);
  mocks.user = { id: 'viewer', email: 'viewer@example.invalid', role: 'VIEWER' };
  expect((await POST(request(), context)).status).toBe(403);
  mocks.user.role = 'ADMIN';
  expect((await POST(request(false, 'https://attacker.invalid'), context)).status).toBe(403);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('rejects extra fields and does not sync on GET', async () => {
  expect((await POST(request(true), context)).status).toBe(400);
  expect((await GET(request(), context)).status).toBe(404);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('syncs only the explicitly configured advertiser account', async () => {
  expect((await POST(request(), context)).status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledWith('admin@example.invalid');
});
