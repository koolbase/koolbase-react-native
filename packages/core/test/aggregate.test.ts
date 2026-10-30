import { KoolbaseDatabase } from '../src/database';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Aggregate: count and total over a whole collection.
//
// The endpoint and the Flutter SDK have had this; @koolbase/js could only
// page through records and add them up in the client, which is a different
// and wrong answer — it sees one page, and it sees only what the read rule
// returned to that page.
//
// The part worth testing hardest is the accounting. A sum over a schemaless
// collection can skip a record whose value is missing or not a number, and a
// total that silently excluded three orders is a wrong number that looks
// right. If the mapping drops `accounting`, nothing fails and every caller
// is quietly misinformed.

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

describe('aggregate', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('sends the snake_case wire shape', async () => {
    respond({ groups: [], matched: 0, accounting: {} });

    await db().aggregate({
      collection: 'orders',
      groupBy: { field: 'created_at', bucket: 'month', timezone: 'Africa/Accra' },
      measures: [{ aggregate: 'sum', field: 'total', as: 'revenue' }],
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    const [url, init] = calls[calls.length - 1];
    expect(url).toContain('/v1/sdk/db/aggregate');
    expect(JSON.parse(init.body)).toEqual({
      collection: 'orders',
      group_by: { field: 'created_at', bucket: 'month', timezone: 'Africa/Accra' },
      measures: [{ aggregate: 'sum', field: 'total', as: 'revenue' }],
    });
  });

  it('omits group_by and where when absent', async () => {
    // An empty `where: []` is not the same as no filter to a server reading
    // the key's presence, and sending group_by: undefined is worse.
    respond({ groups: [], matched: 0, accounting: {} });

    await db().aggregate({
      collection: 'orders',
      measures: [{ aggregate: 'count', as: 'n' }],
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    const body = JSON.parse(calls[calls.length - 1][1].body);
    expect(body).toEqual({
      collection: 'orders',
      measures: [{ aggregate: 'count', as: 'n' }],
    });
    expect('group_by' in body).toBe(false);
    expect('where' in body).toBe(false);
  });

  it('a count measure sends no field', async () => {
    respond({ groups: [], matched: 0, accounting: {} });
    await db().aggregate({
      collection: 'orders',
      measures: [{ aggregate: 'count', as: 'n' }],
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    const body = JSON.parse(calls[calls.length - 1][1].body);
    expect('field' in body.measures[0]).toBe(false);
  });

  it('maps groups and accounting, including why records were skipped', async () => {
    respond({
      groups: [
        { category: '2026-09', values: { revenue: 1200.5 } },
        { category: '2026-08', values: { revenue: 900 } },
      ],
      matched: 903,
      accounting: {
        revenue: { counted: 900, skipped: 3, skipped_reason: 'not_numeric' },
      },
    });

    const r = await db().aggregate({
      collection: 'orders',
      measures: [{ aggregate: 'sum', field: 'total', as: 'revenue' }],
    });

    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].values.revenue).toBe(1200.5);
    expect(r.matched).toBe(903);
    // The whole point: 900 of 903 is a different fact from all of them.
    expect(r.accounting.revenue.counted).toBe(900);
    expect(r.accounting.revenue.skipped).toBe(3);
    expect(r.accounting.revenue.skippedReason).toBe('not_numeric');
  });

  it('too_many_groups comes back as a real false when absent', async () => {
    // A missing field reading as undefined makes `if (!r.tooManyGroups)`
    // pass on a refused request — the caller draws an empty chart as though
    // it were the answer.
    respond({ groups: [], matched: 0, accounting: {} });
    const r = await db().aggregate({
      collection: 'orders',
      measures: [{ aggregate: 'count', as: 'n' }],
    });
    expect(r.tooManyGroups).toBe(false);
  });

  it('a refused request has no groups and says so', async () => {
    respond({ groups: [], matched: 1_000_000, accounting: {}, too_many_groups: true });
    const r = await db().aggregate({
      collection: 'events',
      groupBy: { field: 'user_id' },
      measures: [{ aggregate: 'count', as: 'n' }],
    });

    expect(r.tooManyGroups).toBe(true);
    // Empty deliberately: a partial set drawn as the whole is the wrong
    // number this API exists to prevent.
    expect(r.groups).toEqual([]);
  });
});

describe('aggregate below the count minimum (#299)', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('says fewer than N, on the result and on the group', async () => {
    respond({
      groups: [{ category: '', values: { value: null }, fewer_than: 5 }],
      matched: 0,
      accounting: {},
      fewer_than: 5,
    });
    const r = await db().aggregate({
      collection: 'tickets',
      measures: [{ aggregate: 'count', as: 'value' }],
    });
    expect(r.fewerThan).toBe(5);
    expect(r.groups[0].fewerThan).toBe(5);
    expect(r.groups[0].values.value).toBeNull();
  });

  it('is absent when the number is said', async () => {
    respond({
      groups: [{ category: '', values: { value: 120 } }],
      matched: 120,
      accounting: { value: { counted: 120, skipped: 0 } },
    });
    const r = await db().aggregate({
      collection: 'tickets',
      measures: [{ aggregate: 'count', as: 'value' }],
    });
    expect('fewerThan' in r).toBe(false);
    expect('fewerThan' in r.groups[0]).toBe(false);
    expect(r.groups[0].values.value).toBe(120);
  });
});

describe('aggregate with the typed filter', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  const upcoming = {
    field: 'starts_at',
    operator: 'after',
    value: { kind: 'relative_time', preset: 'now' },
  } as never;

  function sent(): Record<string, unknown> {
    const call = (global.fetch as jest.Mock).mock.calls[0];
    return JSON.parse(call[1].body as string);
  }

  it('sends the tree as where, and its zone', async () => {
    respond({ groups: [], matched: 0, accounting: {} });
    await db().aggregate({
      collection: 'events',
      filter: upcoming,
      timezone: 'Africa/Accra',
      measures: [{ aggregate: 'count', as: 'value' }],
    });
    const body = sent();
    expect(body.where).toEqual(upcoming);
    expect(body.timezone).toBe('Africa/Accra');
  });

  it('sends the old filters exactly as before', async () => {
    respond({ groups: [], matched: 0, accounting: {} });
    await db().aggregate({
      collection: 'events',
      where: [{ field: 'featured', op: 'eq', value: true }],
      measures: [{ aggregate: 'count', as: 'value' }],
    });
    const body = sent();
    expect(body.where).toEqual([{ field: 'featured', op: 'eq', value: true }]);
    expect(body.timezone).toBeUndefined();
  });

  it('refuses filter and where together, before anything is sent', async () => {
    respond({ groups: [], matched: 0, accounting: {} });
    await expect(
      db().aggregate({
        collection: 'events',
        where: [{ field: 'featured', op: 'eq', value: true }],
        filter: upcoming,
        measures: [{ aggregate: 'count', as: 'value' }],
      }),
    ).rejects.toThrow(TypeError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

