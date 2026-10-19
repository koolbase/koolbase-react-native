// #160: a search over the fields it names, on the server. The query sends
// field_search; the collection controller searches once the typing pauses,
// lets the newest search win, replaces what it shows with the server's
// answer (never merged with it), pages inside the search, and says when the
// server could not answer -- so a preview is never taken for the answer.

import { KoolbaseDatabase } from '../src/database';
import { KoolbaseCollectionController } from '../src/collection-controller';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;
const db = () => new KoolbaseDatabase(config, () => 'user-1', async () => 'token');

const row = (id: string, title: string) => ({
  $id: id,
  $collection: 'events',
  $createdAt: '2026-10-19T00:00:00Z',
  $updatedAt: '2026-10-19T00:00:00Z',
  title,
});

type Page = { records: Record<string, unknown>[]; total: number };
type Answer = (body: any) => Page | { status: number; error: string } | Promise<Page | { status: number; error: string }>;

function serve(answer: Answer): any[] {
  const bodies: any[] = [];
  global.fetch = jest.fn(async (_input: unknown, init?: { body?: unknown }) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    bodies.push(body);
    const out = await answer(body);
    if ('status' in out) {
      return new Response(JSON.stringify({ error: out.error }), { status: out.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return bodies;
}

function gate() {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => { release = resolve; });
  return { opened, open: () => release() };
}

async function settle(ms = 0) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const titles = (c: KoolbaseCollectionController) => c.getState().records.map((r) => r.data.title);
const food = { text: 'food', fields: ['title'], choices: [{ field: 'status', values: ['in_progress'], listed: ['draft', 'in_progress'] }] };

describe('field_search (#160)', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('query sends field_search; empty text sends none', async () => {
    const bodies = serve(() => ({ records: [], total: 0 }));
    await db().query('events', { fieldSearch: food, cache: 'network-only' });
    expect(bodies[0].field_search).toEqual(food);
    await db().query('events', { fieldSearch: { text: '  ', fields: ['title'] }, cache: 'network-only' });
    expect(bodies[1].field_search).toBeUndefined();
  });

  it('searches once the typing pauses, with the latest text; the answer replaces what is shown', async () => {
    const bodies = serve((b) =>
      b.field_search
        ? { records: [row('9', `${b.field_search.text} fair`)], total: 1 }
        : { records: [row('1', 'Book swap'), row('2', 'Pottery')], total: 30 },
    );
    const c = new KoolbaseCollectionController(db(), 'events', { searchDelayMs: 20 });
    await c.load();
    expect(titles(c)).toEqual(['Book swap', 'Pottery']);

    c.setSearch({ text: 'f', fields: ['title'] });
    c.setSearch({ text: 'fo', fields: ['title'] });
    c.setSearch(food);
    expect(c.getState().searching).toBe(true);
    expect(titles(c)).toEqual(['Book swap', 'Pottery']); // the preview's source, until the answer
    await settle(40);

    const searched = bodies.filter((b) => b.field_search);
    expect(searched).toHaveLength(1);
    expect(searched[0].field_search.text).toBe('food');
    expect(searched[0].offset).toBe(0);
    expect(c.getState().searching).toBe(false);
    expect(titles(c)).toEqual(['food fair']); // replaced, not merged
    expect(c.getState().hasMore).toBe(false);
  });

  it('the newest search wins: an older answer landing late is dropped', async () => {
    const slow = gate();
    serve(async (b) => {
      if (b.field_search?.text === 'old') {
        await slow.opened;
        return { records: [row('1', 'old answer')], total: 1 };
      }
      return b.field_search ? { records: [row('2', 'new answer')], total: 1 } : { records: [], total: 0 };
    });
    const c = new KoolbaseCollectionController(db(), 'events', { searchDelayMs: 1 });
    await c.load();
    c.setSearch({ text: 'old', fields: ['title'] });
    await settle(10);
    c.setSearch({ text: 'new', fields: ['title'] });
    await settle(10);
    expect(titles(c)).toEqual(['new answer']);
    slow.open();
    await settle();
    expect(titles(c)).toEqual(['new answer']);
    expect(c.getState().searching).toBe(false);
  });

  it('pages inside the search', async () => {
    const bodies = serve((b) =>
      b.field_search
        ? { records: [row(`m${b.offset}`, `match ${b.offset}`)], total: 2 }
        : { records: [], total: 0 },
    );
    const c = new KoolbaseCollectionController(db(), 'events', { search: food, limit: 1 });
    await c.load();
    expect(titles(c)).toEqual(['match 0']);
    await c.loadMore();
    expect(titles(c)).toEqual(['match 0', 'match 1']);
    expect(bodies.every((b) => b.field_search?.text === 'food')).toBe(true);
    expect(bodies.map((b) => b.offset)).toEqual([0, 1]);
  });

  it('a search the server could not answer says so; what is shown is not its answer', async () => {
    serve((b) => (b.field_search ? { status: 400, error: 'field_search: field "starts_at" is datetime, not text a search can match' } : { records: [row('1', 'Book swap')], total: 1 }));
    const c = new KoolbaseCollectionController(db(), 'events', { searchDelayMs: 1 });
    await c.load();
    c.setSearch({ text: 'x', fields: ['starts_at'] });
    await settle(10);
    const s = c.getState();
    expect(s.searching).toBe(false);
    expect(s.searchError).not.toBeNull();
    expect(s.status).toBe('loaded');
    // Cleared: the list unsearched again, the error gone.
    c.setSearch(null);
    await settle(10);
    expect(c.getState().searchError).toBeNull();
    expect(titles(c)).toEqual(['Book swap']);
  });

  it('the same search again does nothing', async () => {
    const bodies = serve(() => ({ records: [], total: 0 }));
    const c = new KoolbaseCollectionController(db(), 'events', { search: food, searchDelayMs: 1 });
    await c.load();
    c.setSearch({ ...food, text: ' food ' });
    await settle(10);
    expect(bodies).toHaveLength(1);
    expect(c.getState().searching).toBe(false);
  });
});

describe('field_search (#160): the edges', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('a searched query is never served from, or kept in, the cache', async () => {
    let n = 0;
    serve((b) => ({ records: [row(String(++n), `${b.field_search?.text ?? 'all'} ${n}`)], total: 1 }));
    const d = db();
    const a = await d.query('events', { fieldSearch: food });
    const b = await d.query('events', { fieldSearch: food });
    expect(a.isFromCache).toBe(false);
    expect(b.isFromCache).toBe(false);
    expect(b.records[0].data.title).toBe('food 2');
  });

  it('no next page while a search waits; a refresh that answers it ends the wait', async () => {
    const bodies = serve((b) =>
      b.field_search ? { records: [row('9', 'food fair')], total: 1 } : { records: [row('1', 'a')], total: 5 },
    );
    const c = new KoolbaseCollectionController(db(), 'events', { searchDelayMs: 20, limit: 1 });
    await c.load();
    c.setSearch(food);
    await c.loadMore();
    expect(bodies.filter((b) => b.offset > 0)).toHaveLength(0);
    await c.refresh();
    expect(titles(c)).toEqual(['food fair']);
    await settle(40);
    expect(c.getState().searching).toBe(false);
    expect(c.getState().loadingMore).toBe(false);
  });

  it('a search that fails before anything loaded: the list\'s error, not a spinner', async () => {
    const slow = gate();
    serve(async (b) => {
      if (!b.field_search) {
        await slow.opened;
        return { records: [], total: 0 };
      }
      return { status: 503, error: 'down' };
    });
    const c = new KoolbaseCollectionController(db(), 'events', { searchDelayMs: 1 });
    void c.load();
    c.setSearch(food);
    await settle(10);
    expect(c.getState().status).toBe('error');
    expect(c.getState().searchError).not.toBeNull();
    slow.open();
    await settle();
    expect(c.getState().status).toBe('error');
  });
});
