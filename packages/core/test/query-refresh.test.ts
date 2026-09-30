import {
  registerQueryRefresher,
  refreshCollectionQueries,
  clearQueryRefreshers,
} from '../src/query-refresh';
import { KoolbaseCollectionController } from '../src/collection-controller';

/**
 * A write refreshed nothing: a list on screen kept showing what it loaded
 * until the app was reloaded (Expo, 2026-09-30). The Flutter SDK re-runs
 * every open query on the written collection; this is the same.
 */
describe('refreshCollectionQueries', () => {
  beforeEach(() => clearQueryRefreshers());

  it('re-runs the queries on the written collection, and only those', async () => {
    const ran: string[] = [];
    registerQueryRefresher('tasks', async () => { ran.push('tasks-a'); });
    registerQueryRefresher('tasks', async () => { ran.push('tasks-b'); });
    registerQueryRefresher('songs', async () => { ran.push('songs'); });
    await refreshCollectionQueries('tasks');
    expect(ran).toEqual(['tasks-a', 'tasks-b']);
  });

  it('re-runs every query when the collection is not known', async () => {
    const ran: string[] = [];
    registerQueryRefresher('tasks', async () => { ran.push('tasks'); });
    registerQueryRefresher('songs', async () => { ran.push('songs'); });
    await refreshCollectionQueries(undefined);
    expect(ran.sort()).toEqual(['songs', 'tasks']);
  });

  it('a failed refresh never stops the others', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ran: string[] = [];
    registerQueryRefresher('tasks', async () => { throw new Error('boom'); });
    registerQueryRefresher('tasks', async () => { ran.push('second'); });
    await refreshCollectionQueries('tasks');
    expect(ran).toEqual(['second']);
    warn.mockRestore();
  });

  it('an unregistered query is not refreshed', async () => {
    const ran: string[] = [];
    const off = registerQueryRefresher('tasks', async () => { ran.push('x'); });
    off();
    await refreshCollectionQueries('tasks');
    expect(ran).toEqual([]);
  });
});

describe('KoolbaseCollectionController after a write', () => {
  beforeEach(() => clearQueryRefreshers());

  function fakeDb() {
    const calls: { cache: unknown }[] = [];
    let title = 'first';
    const db = {
      query: async (_c: string, o: { cache?: unknown }) => {
        calls.push({ cache: o.cache });
        return { records: [{ id: 'r1', data: { title } }], total: 1 } as any;
      },
    };
    return { db, calls, setTitle: (t: string) => { title = t; } };
  }

  it('re-runs its query from the server, silently: refreshing is never raised', async () => {
    const f = fakeDb();
    const c = new KoolbaseCollectionController(f.db as any, 'tasks');
    await c.load();
    const seen: boolean[] = [];
    c.subscribe(() => seen.push(c.getState().refreshing));
    f.setTitle('after the write');
    await refreshCollectionQueries('tasks');
    expect(f.calls.map((x) => x.cache)).toEqual(['default', 'network-only']);
    expect((c.getState().records[0] as any).data.title).toBe('after the write');
    expect(seen.every((r) => r === false)).toBe(true);
  });

  it('once disposed, a write never re-runs it', async () => {
    const f = fakeDb();
    const c = new KoolbaseCollectionController(f.db as any, 'tasks');
    await c.load();
    c.dispose();
    await refreshCollectionQueries('tasks');
    expect(f.calls).toHaveLength(1);
  });
});
