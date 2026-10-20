/**
 * The typed query (#165): which records to read, written as a tree the
 * server validates against the collection's declared fields and runs after
 * its read rule, so a filter can only narrow what the caller may read.
 * Same names and the same JSON as the Flutter SDK's KbWhere.
 *
 * ```ts
 * await Koolbase.db.query('events', {
 *   where: KbWhere.and([
 *     KbField('starts_at').after(KbValue.now()),
 *     KbWhere.or([KbField('category').isIn(['music', 'food']), KbField('price').eq(0)]),
 *   ]),
 *   sort: [KbSort.desc('featured'), KbSort.asc('starts_at')],
 * });
 * ```
 *
 * Operators follow the field's declared type; the server refuses one the
 * type does not take (`query_operator_invalid`), or a range or date operator
 * on an undeclared field (`query_field_untyped`). Limits, the server's:
 * groups 3 deep (the outer group is 1), 20 conditions, 100 values in a list.
 */

export type KbValueJson =
  | { kind: 'literal'; value: unknown }
  | { kind: 'relative_time'; preset: string; offset?: { amount: number; unit: 'minutes' | 'hours' | 'days' } }
  | { kind: 'caller'; path: string }
  | { kind: 'range'; from: KbValueJson; to: KbValueJson };

export type KbWhereNode =
  | { op: 'and' | 'or'; conditions: KbWhereNode[] }
  | { field: string; operator: string; value?: KbValueJson };

export interface KbSortField {
  field: string;
  dir: 'asc' | 'desc';
}

function group(op: 'and' | 'or', conditions: KbWhereNode[]): KbWhereNode {
  if (conditions.length === 0) throw new TypeError('a group needs at least one condition');
  return { op, conditions: [...conditions] };
}

export const KbWhere = {
  /** Every condition must hold. */
  and: (all: KbWhereNode[]): KbWhereNode => group('and', all),
  /** At least one condition must hold. */
  or: (any: KbWhereNode[]): KbWhereNode => group('or', any),
};

function plain(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

export const KbValue = {
  /** v as an operand: a KbValueJson as is; a Date as an instant (UTC, ISO 8601); a list item by item. */
  of(v: unknown): KbValueJson {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'kind' in (v as object)) {
      return v as KbValueJson;
    }
    if (Array.isArray(v)) return { kind: 'literal', value: v.map(plain) };
    return { kind: 'literal', value: plain(v) };
  },
  /** The server's clock now, optionally moved. */
  now(offset: { minutes?: number; hours?: number } = {}): KbValueJson {
    const m = (offset.hours ?? 0) * 60 + (offset.minutes ?? 0);
    if (m === 0) return { kind: 'relative_time', preset: 'now' };
    return {
      kind: 'relative_time',
      preset: 'now',
      offset: m % 60 === 0 ? { amount: m / 60, unit: 'hours' } : { amount: m, unit: 'minutes' },
    };
  },
  /** The start of today in the query's zone, optionally `days` later (calendar days). */
  startOfToday(opts: { days?: number } = {}): KbValueJson {
    return opts.days
      ? { kind: 'relative_time', preset: 'start_of_today', offset: { amount: opts.days, unit: 'days' } }
      : { kind: 'relative_time', preset: 'start_of_today' };
  },
  startOfTomorrow: (): KbValueJson => ({ kind: 'relative_time', preset: 'start_of_tomorrow' }),
  /** Weeks start on Monday. */
  startOfWeek: (): KbValueJson => ({ kind: 'relative_time', preset: 'start_of_week' }),
  startOfNextWeek: (): KbValueJson => ({ kind: 'relative_time', preset: 'start_of_next_week' }),
  startOfMonth: (): KbValueJson => ({ kind: 'relative_time', preset: 'start_of_month' }),
  /** The signed-in user's id, from the session. Refused (caller_required) signed out. */
  callerUserId: (): KbValueJson => ({ kind: 'caller', path: 'user_id' }),
  /** One of the signed-in user's claims, as the server set it. Refused (caller_claim_missing) without it. */
  callerClaim: (name: string): KbValueJson => ({ kind: 'caller', path: `claims.${name}` }),
};

/** A record field to filter on: a declared field, or id, created_at, updated_at, created_by. */
export function KbField(name: string) {
  const withValue = (operator: string, v: unknown): KbWhereNode => {
    if (v === null || v === undefined) throw new TypeError(`${name}: no value; use isEmpty() for "has none"`);
    return { field: name, operator, value: KbValue.of(v) };
  };
  const bare = (operator: string): KbWhereNode => ({ field: name, operator });
  return {
    eq: (v: unknown) => withValue('eq', v),
    neq: (v: unknown) => withValue('neq', v),
    gt: (v: unknown) => withValue('gt', v),
    gte: (v: unknown) => withValue('gte', v),
    lt: (v: unknown) => withValue('lt', v),
    lte: (v: unknown) => withValue('lte', v),
    contains: (text: string) => withValue('contains', text),
    startsWith: (text: string) => withValue('starts_with', text),
    /** One of the values: a list, or the caller's claim that holds one. */
    isIn: (values: unknown) => withValue('in', values),
    notIn: (values: unknown) => withValue('not_in', values),
    /** Inclusive at both ends. */
    between: (from: unknown, to: unknown): KbWhereNode => ({
      field: name,
      operator: 'between',
      value: { kind: 'range', from: KbValue.of(from), to: KbValue.of(to) },
    }),
    before: (when: unknown) => withValue('before', when),
    after: (when: unknown) => withValue('after', when),
    onOrBefore: (when: unknown) => withValue('on_or_before', when),
    onOrAfter: (when: unknown) => withValue('on_or_after', when),
    /** The calendar day of `when` in the query's zone. */
    on: (when: unknown) => withValue('on', when),
    /** No value: missing, null or an empty list. 0, false and an empty text are values. */
    isEmpty: () => bare('is_empty'),
    isNotEmpty: () => bare('is_not_empty'),
    isTrue: () => bare('is_true'),
    isFalse: () => bare('is_false'),
  };
}

/** One sort field. Typed by the declaration; empty values last both ways; the id breaks ties. */
export const KbSort = {
  asc: (field: string): KbSortField => ({ field, dir: 'asc' }),
  desc: (field: string): KbSortField => ({ field, dir: 'desc' }),
};

/** Whether options speak #165's language. */
export function isTypedQuery(o: { where?: unknown; sort?: unknown[]; timezone?: string }): boolean {
  return o.where !== undefined || (o.sort !== undefined && o.sort.length > 0) || (o.timezone ?? '') !== '';
}

/** The device's IANA zone ("Africa/Accra"), or undefined when the runtime cannot say -- the query then omits it and the server uses UTC. */
export function deviceZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' && zone !== 'Etc/Unknown' ? zone : undefined;
  } catch {
    return undefined;
  }
}
