/**
 * Asking "how many" and "how much" over a collection, correctly.
 *
 * Correct means the whole authorized set — never the first page — with the
 * caller's read rule applied inside the query, and never a bare number:
 * collections are schemaless, so a total that quietly excluded three
 * malformed rows would be a wrong number that looks right. Every result
 * carries its accounting.
 *
 * ```ts
 * const r = await Koolbase.db.aggregate({
 *   collection: 'orders',
 *   groupBy: { field: 'created_at', bucket: 'month', timezone: 'Africa/Accra' },
 *   measures: [{ aggregate: 'sum', field: 'total', as: 'revenue' }],
 * });
 *
 * for (const g of r.groups) {
 *   console.log(g.category, g.values.revenue);
 * }
 * if (r.accounting.revenue.skipped > 0) {
 *   // some orders had a total that was not a number — say so
 * }
 * ```
 */

/** A record filter, AND-ed on top of the read rule. */
export interface KoolbaseAggregateFilter {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte';
  value: unknown;
}

/**
 * The category axis: a field's value, or a calendar bucket of a timestamp
 * field.
 *
 * A bucket REQUIRES a timezone, and the union makes omitting it a type
 * error. "Midnight" means nothing without one — Africa/Accra and UTC
 * disagree about which day a 23:30 sale belongs to — and the API refuses a
 * bucket that arrives without one.
 */
export type KoolbaseGroupBy =
  | { field: string; bucket?: never; timezone?: never }
  | {
      field: string;
      bucket: 'day' | 'week' | 'month' | 'year';
      timezone: string;
    };

/**
 * One number per group.
 *
 * `count` counts RECORDS, so it takes no field and skips nothing. The others
 * read a field, and a record whose value is missing or not a number is
 * skipped and reported in the result's accounting.
 */
export type KoolbaseMeasure =
  | { aggregate: 'count'; field?: never; as: string }
  | {
      aggregate: 'sum' | 'avg' | 'min' | 'max';
      field: string;
      as: string;
    };

/** One aggregation request. */
export interface KoolbaseAggregateRequest {
  collection: string;
  /** AND-ed record filters on top of the read rule. */
  where?: KoolbaseAggregateFilter[];
  /** Absent means one group: the measures over everything. */
  groupBy?: KoolbaseGroupBy;
  /** At least one. */
  measures: KoolbaseMeasure[];
}

/** One category and its numbers. */
export interface KoolbaseAggregateGroup {
  /** Empty string for the single group when there was no groupBy. */
  category: string;
  /** Keyed by each measure's `as`. Null where a group had nothing to measure. */
  values: Record<string, number | null>;
}

/**
 * How a measure arrived at its number.
 *
 * `skipped` is not an error. It is what you need to decide whether the
 * number means what it appears to mean — a revenue total over 900 of 903
 * orders is a different fact from one over all of them, and only this says
 * which you are looking at.
 */
export interface KoolbaseAggregateAccounting {
  counted: number;
  skipped: number;
  /** Present when skipped > 0. */
  skippedReason?: 'missing' | 'not_numeric' | 'mixed';
}

/** The whole answer, including what could not be counted. */
export interface KoolbaseAggregateResult {
  /**
   * One per category, sorted — or exactly one with an empty category when
   * there was no groupBy.
   */
  groups: KoolbaseAggregateGroup[];
  /** Records that matched the read rule and filters: the denominator. */
  matched: number;
  /** Per measure name, keyed by its `as`. */
  accounting: Record<string, KoolbaseAggregateAccounting>;
  /**
   * True when the groupBy produced more categories than allowed and the
   * whole request was refused.
   *
   * `groups` is EMPTY when this is set: a partial set drawn as the whole
   * would be exactly the wrong number this API exists to prevent.
   */
  tooManyGroups: boolean;
}
