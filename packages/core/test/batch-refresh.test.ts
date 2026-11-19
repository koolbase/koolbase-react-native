// 12.49.0: a batch that changes or deletes records re-reads the live queries
// on their collections, as a single update or delete does -- before, only a
// batch's inserts and upserts did, so a list on screen kept showing records a
// bulk Set status or a bulk Delete had changed (the Designer's bulk bar, P4c).
import { KoolbaseDatabase } from '../src/database';
import { cacheRecord } from '../src/cache-store';
import { clearQueryRefreshers, registerQueryRefresher } from '../src/query-refresh';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;

const wire = (id: string, collection: string, stage: string) => ({
  $id: id,
  $collection: collection,
  $createdAt: '2026-11-19T00:00:00Z',
  $updatedAt: '2026-11-19T00:00:00Z',
  $revision: 2,
  stage,
});

function serveBatch(results: unknown[]) {
  global.fetch = jest.fn(async () =>
    new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function listen(): string[] {
  const ran: string[] = [];
  registerQueryRefresher('deals', async () => { ran.push('deals'); });
  registerQueryRefresher('companies', async () => { ran.push('companies'); });
  return ran;
}

describe('a batch re-reads the lists it changed (12.49.0)', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
    clearQueryRefreshers();
  });

  it('updates: their collection, from the records returned', async () => {
    const ran = listen();
    serveBatch([
      { type: 'update', record: wire('d1', 'deals', 'won') },
      { type: 'update', record: wire('d2', 'deals', 'won') },
    ]);
    const db = new KoolbaseDatabase(config, () => 'user-1', async () => 'token');
    await db.batch([
      { type: 'update', recordId: 'd1', data: { stage: 'won' } },
      { type: 'update', recordId: 'd2', data: { stage: 'won' } },
    ]);
    await settle();
    expect(ran).toEqual(['deals']);
  });

  it('deletes: their collection, from the device\'s saved copies', async () => {
    const ran = listen();
    await cacheRecord('user-1', 'deals', 'd1', { stage: 'lead' }, 1);
    await cacheRecord('user-1', 'deals', 'd2', { stage: 'lead' }, 1);
    serveBatch([{ type: 'delete', deleted: true }, { type: 'delete', deleted: true }]);
    const db = new KoolbaseDatabase(config, () => 'user-1', async () => 'token');
    await db.batch([
      { type: 'delete', recordId: 'd1' },
      { type: 'delete', recordId: 'd2' },
    ]);
    await settle();
    expect(ran).toEqual(['deals']);
  });

  it('a record never read here: every live query, rather than a guess', async () => {
    const ran = listen();
    serveBatch([{ type: 'delete', deleted: true }]);
    const db = new KoolbaseDatabase(config, () => 'user-1', async () => 'token');
    await db.batch([{ type: 'delete', recordId: 'never-seen' }]);
    await settle();
    expect(ran.sort()).toEqual(['companies', 'deals']);
  });
});
