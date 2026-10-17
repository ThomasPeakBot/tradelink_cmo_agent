import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
  sync: vi.fn(),
  alerts: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  currentUser: async () => mocks.user,
  assertOrigin: (request: Request) => {
    if (request.headers.get('origin') !== 'http://localhost') throw new Error('INVALID_ORIGIN');
  },
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/stripe-sync', () => ({ syncStripe: mocks.sync }));
vi.mock('@/lib/alerts', () => ({ refreshAlerts: mocks.alerts }));
import { POST, GET } from '../app/api/[resource]/route';
import { StripeReadError } from '../lib/stripe';
const context = { params: Promise.resolve({ resource: 'stripe-sync' }) };
const request = (origin = 'http://localhost') =>
  new Request('http://localhost/api/stripe-sync', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' };
});
it('requires authentication, ADMIN role and same origin before contacting Stripe', async () => {
  mocks.user = null;
  expect((await POST(request(), context)).status).toBe(401);
  mocks.user = { id: 'viewer', email: 'viewer@example.invalid', role: 'VIEWER' };
  expect((await POST(request(), context)).status).toBe(403);
  mocks.user.role = 'ADMIN';
  expect((await POST(request('https://untrusted.example'), context)).status).toBe(403);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('does not sync on GET', async () => {
  expect((await GET(request(), context)).status).toBe(404);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('runs an explicit sync and refreshes alerts', async () => {
  expect((await POST(request(), context)).status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledWith('admin@example.invalid');
  expect(mocks.alerts).toHaveBeenCalledWith('admin');
});
it('returns safe adapter errors without returning stored data or credentials', async () => {
  mocks.sync.mockRejectedValueOnce(new StripeReadError('permission', 'Stripe rejected access.'));
  const response = await POST(request(), context);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Stripe rejected access.', code: 'permission' });
  expect(mocks.alerts).not.toHaveBeenCalled();
});
