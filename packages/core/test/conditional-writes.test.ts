import { KoolbaseDatabase } from '../src/database';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';
import { registerQueryRefresher, clearQueryRefreshers } from '../src/query-refresh';

// Conditional writes (12.8.0): update and delete take expectedRevision, as the
// Flutter SDK's do, and a write refused as stale refreshes the live lists so
// they show the newer data. Post-write refreshes run in the background: a
// write resolves without waiting for the lists (12.7.0 waited).

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

function respond(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

function db(): KoolbaseDatabase {
  return new KoolbaseDatabase(config, () => 'user-1', async () => 'token');
}

const record = { $id: 'r1', $collection: 'tasks', $revision: 4, $createdAt: '2026-01-01T00:00:00Z', $updatedAt: '2026-01-01T00:00:00Z', done: true };
const calls = () => (global.fetch as jest.Mock).mock.calls;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('conditional writes', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
    clearQueryRefreshers();
  });

  it('update sends expected_revision in the body, only when asked', async () => {
    respond(record);
    await db().update('r1', { done: true }, { expectedRevision: 3 });
    expect(JSON.parse(calls()[0][1].body)).toEqual({ data: { done: true }, expected_revision: 3 });
    respond(record);
    await db().update('r1', { done: true });
    expect(JSON.parse(calls()[0][1].body)).toEqual({ data: { done: true } });
  });

  it('delete sends expected_revision in the URL, only when asked', async () => {
    respond(null, 204);
    await db().delete('r1', { expectedRevision: 3 });
    expect(String(calls()[0][0])).toMatch(/\/v1\/sdk\/db\/records\/r1\?expected_revision=3$/);
    respond(null, 204);
    await db().delete('r1');
    expect(String(calls()[0][0])).toMatch(/\/v1\/sdk\/db\/records\/r1$/);
  });

  it('a revision mismatch throws, unchanged, and refreshes the live lists', async () => {
    const ran: string[] = [];
    registerQueryRefresher('tasks', async () => { ran.push('tasks'); });
    respond({ code: 'revision_mismatch', error: 'changed', details: { expected_revision: 3, current_revision: 4 } }, 409);
    await expect(db().update('r1', { done: true }, { expectedRevision: 3 })).rejects.toMatchObject({ name: 'KoolbaseRevisionMismatchError' });
    await settle();
    expect(ran).toEqual(['tasks']);
    respond({ code: 'revision_mismatch', error: 'changed', details: { expected_revision: 3, current_revision: 4 } }, 409);
    await expect(db().delete('r1', { expectedRevision: 3 })).rejects.toMatchObject({ name: 'KoolbaseRevisionMismatchError' });
    await settle();
    expect(ran).toEqual(['tasks', 'tasks']);
  });

  it('a write resolves without waiting for the lists to refresh (background, as Flutter)', async () => {
    registerQueryRefresher('tasks', () => new Promise<void>(() => {}));
    respond(record);
    const done = await Promise.race([db().update('r1', { done: true }).then(() => 'resolved'), new Promise((r) => setTimeout(() => r('waited'), 200))]);
    expect(done).toBe('resolved');
  });
});
