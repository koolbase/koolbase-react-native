import { KbField, KbSort, KbValue, KbWhere, deviceZone, isTypedQuery } from '../src/query-builder';
import { koolbaseDataError } from '../src/database-errors';
import { collectionQueryKey } from '../src/collection-controller';

// #165b: the typed query as the JS SDK writes it -- exactly the JSON the API
// parses (claude/query_contract_165.md) and the Flutter SDK sends.
describe('the typed query', () => {
  it('builders write the contract JSON', () => {
    const tree = KbWhere.and([
      KbField('starts_at').after(KbValue.now()),
      KbWhere.or([KbField('category').isIn(['music', 'food']), KbField('price').eq(0)]),
      KbField('price').between(10, 100),
      KbField('created_by').eq(KbValue.callerUserId()),
      KbField('org').eq(KbValue.callerClaim('org')),
      KbField('poster').isNotEmpty(),
      KbField('starts_at').on(KbValue.startOfToday({ days: 1 })),
      KbField('starts_at').before(KbValue.now({ hours: 2 })),
      KbField('starts_at').after(KbValue.now({ minutes: -30 })),
      KbField('starts_at').after(new Date(Date.UTC(2026, 10, 7, 18))),
    ]);
    expect(tree).toEqual({
      op: 'and',
      conditions: [
        { field: 'starts_at', operator: 'after', value: { kind: 'relative_time', preset: 'now' } },
        {
          op: 'or',
          conditions: [
            { field: 'category', operator: 'in', value: { kind: 'literal', value: ['music', 'food'] } },
            { field: 'price', operator: 'eq', value: { kind: 'literal', value: 0 } },
          ],
        },
        {
          field: 'price',
          operator: 'between',
          value: { kind: 'range', from: { kind: 'literal', value: 10 }, to: { kind: 'literal', value: 100 } },
        },
        { field: 'created_by', operator: 'eq', value: { kind: 'caller', path: 'user_id' } },
        { field: 'org', operator: 'eq', value: { kind: 'caller', path: 'claims.org' } },
        { field: 'poster', operator: 'is_not_empty' },
        {
          field: 'starts_at',
          operator: 'on',
          value: { kind: 'relative_time', preset: 'start_of_today', offset: { amount: 1, unit: 'days' } },
        },
        {
          field: 'starts_at',
          operator: 'before',
          value: { kind: 'relative_time', preset: 'now', offset: { amount: 2, unit: 'hours' } },
        },
        {
          field: 'starts_at',
          operator: 'after',
          value: { kind: 'relative_time', preset: 'now', offset: { amount: -30, unit: 'minutes' } },
        },
        { field: 'starts_at', operator: 'after', value: { kind: 'literal', value: '2026-11-07T18:00:00.000Z' } },
      ],
    });
    expect([KbSort.desc('featured'), KbSort.asc('starts_at')]).toEqual([
      { field: 'featured', dir: 'desc' },
      { field: 'starts_at', dir: 'asc' },
    ]);
  });

  it('builders refuse what the API would', () => {
    expect(() => KbWhere.and([])).toThrow(TypeError);
    expect(() => KbWhere.or([])).toThrow(TypeError);
    expect(() => KbField('price').eq(null)).toThrow(TypeError);
    expect(() => KbField('price').eq(undefined)).toThrow(TypeError);
  });

  it('knows a typed query from an old one', () => {
    expect(isTypedQuery({})).toBe(false);
    expect(isTypedQuery({ sort: [] })).toBe(false);
    expect(isTypedQuery({ where: KbField('price').gt(0) })).toBe(true);
    expect(isTypedQuery({ sort: [KbSort.asc('price')] })).toBe(true);
    expect(isTypedQuery({ timezone: 'Europe/London' })).toBe(true);
  });

  it('reads the device zone as an IANA name, or none', () => {
    const zone = deviceZone();
    expect(zone === undefined || /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(zone)).toBe(true);
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no Intl');
    });
    try {
      expect(deviceZone()).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('is its own collection entry', () => {
    const upcoming = collectionQueryKey('events', { filter: KbField('starts_at').after(KbValue.now()) });
    const past = collectionQueryKey('events', { filter: KbField('starts_at').before(KbValue.now()) });
    const plain = collectionQueryKey('events', {});
    expect(new Set([upcoming, past, plain]).size).toBe(3);
    expect(collectionQueryKey('events', { filter: KbField('starts_at').after(KbValue.now()) })).toBe(upcoming);
    expect(collectionQueryKey('events', { sort: [KbSort.asc('price')] })).not.toBe(plain);
    expect(collectionQueryKey('events', { timezone: 'Europe/London' })).not.toBe(plain);
  });

  it.each([
    'query_invalid',
    'query_too_complex',
    'query_operator_invalid',
    'query_field_untyped',
    'query_timezone_invalid',
    'query_caller_path_invalid',
    'query_sort_invalid',
    'query_sort_untyped',
  ])('a %s refusal arrives as a validation error with its code', (code) => {
    const err = koolbaseDataError(400, { code, error: 'rank is not declared, so gt cannot compare it' });
    expect(err.constructor.name).toBe('KoolbaseValidationError');
    expect((err as { code?: string }).code).toBe(code);
    expect(err.message).toContain('rank');
  });
});
