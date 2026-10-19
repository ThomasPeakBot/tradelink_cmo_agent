import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
  sync: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  currentUser: async () => state.user,
  assertOrigin: (r: Request) => {
    if (r.headers.get('origin') !== 'http://localhost') throw Error('INVALID_ORIGIN');
  },
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/drive-sync', () => ({ syncDrive: state.sync }));
import { POST, GET } from '../app/api/[resource]/route';
const ctx = { params: Promise.resolve({ resource: 'drive-sync' }) };
const request = (body: unknown = {}, origin = 'http://localhost') =>
  new Request('http://localhost/api/drive-sync', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' };
});
it('requires authentication, admin role and trusted origin', async () => {
  state.user = null;
  expect((await POST(request(), ctx)).status).toBe(401);
  state.user = { id: 'viewer', email: 'viewer@example.invalid', role: 'VIEWER' };
  expect((await POST(request(), ctx)).status).toBe(403);
  state.user.role = 'ADMIN';
  expect((await POST(request({}, 'https://untrusted.invalid'), ctx)).status).toBe(403);
  expect(state.sync).not.toHaveBeenCalled();
});
it('does not sync on GET or accept a client-selected folder', async () => {
  expect((await GET(request(), ctx)).status).toBe(404);
  expect((await POST(request({ folderId: 'another-folder' }), ctx)).status).toBe(400);
  expect(state.sync).not.toHaveBeenCalled();
});
it('imports only through an explicit admin POST', async () => {
  expect((await POST(request(), ctx)).status).toBe(200);
  expect(state.sync).toHaveBeenCalledWith('admin@example.invalid');
});
