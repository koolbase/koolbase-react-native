import {
  KoolbaseError,
  KoolbaseOfflineBaselineUnavailableError,
  KoolbaseUnauthenticatedError,
} from './errors';
import { cacheRecord, getCachedRecord, removeCachedRecord } from './cache-store';
import {
  readOfflineState,
  mutateOfflineState,
  queueWrite,
  QueuedConflict,
} from './offline-state';
import { KoolbaseConflict, ConflictResolver } from './conflict';
import { PendingWrite, toPendingWrite } from './pending-write';
import {
  KoolbaseConfig,
  KoolbaseRecord,
  QueryOptions,
  QueryResult,
  UpsertResult,
  BatchOp,
  BatchResult,
  KoolbaseVector,
  SemanticSearchResult,
  SearchMode,
} from './types';
import {
  getCached,
  setCached,
  invalidateCache,
  optimisticallyInsert,
  hashQuery,
} from './cache-store';
import { SyncEngine } from './sync-engine';
import { recordFromWire } from './record';
import { koolbaseDataError, KoolbaseDataError } from './database-errors';

function generateWriteId(): string {
  return 'local_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
// Record ids are UUIDs from birth: the server honors a caller-supplied UUID id,
// so the optimistic identity and the server identity are the same string and
// chained offline writes need no remapping on replay. Write ids (above) stay
// local_-prefixed — they are idempotency keys, never addresses.
function generateRecordId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function batchOpToWire(op: BatchOp): Record<string, unknown> {
  switch (op.type) {
    case 'insert':
      return { type: 'insert', collection: op.collection, data: op.data };
    case 'update':
      return { type: 'update', record_id: op.recordId, data: op.data };
    case 'delete':
      return { type: 'delete', record_id: op.recordId };
    case 'upsert':
      return {
        type: 'upsert',
        collection: op.collection,
        match: op.match,
        data: op.data,
      };
  }
}

export class KoolbaseDatabase {
  private config: KoolbaseConfig;
  private getUserId: () => string | null;
  private getToken: () => Promise<string | null>;
  /**
   * Called when the server rejects the caller's credentials.
   *
   * A session stops working for the whole SDK at once, so it is cleared before
   * the error reaches the caller — otherwise the app keeps believing it is
   * signed in and every subsequent call fails the same way, with no path back
   * to login.
   */
  private onSessionExpired?: () => Promise<void>;
  private syncEngine: SyncEngine;

  constructor(
    config: KoolbaseConfig,
    getUserId: () => string | null,
    getToken: () => Promise<string | null>,
    onSessionExpired?: () => Promise<void>,
  ) {
    this.config = config;
    this.getUserId = getUserId;
    this.getToken = getToken;
    this.onSessionExpired = onSessionExpired;
    this.syncEngine = new SyncEngine(
      config,
      getUserId,
      getToken,
      undefined,
      onSessionExpired,
    );
    this.syncEngine.start();
  }

  // getUserId is kept only for local cache keys / offline metadata; request
  // identity now comes solely from the verified access token.
  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.publicKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: await this.buildHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    // A 204 carries no body, and some error responses carry none either.
    // Parsing unconditionally would throw before the status was ever checked,
    // which is why delete was written to bypass this path — and why its errors
    // went unreported.
    const text = await res.text();
    let data: unknown = null;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        // Leave data null: a body that is not JSON is not more informative than
        // the status, and failing to parse it must not mask the status.
      }
    }
    if (!res.ok) {
      const err = koolbaseDataError(
        res.status,
        (data as Record<string, unknown>) ?? {},
        `Request failed: ${res.status}`
      );
      if (err instanceof KoolbaseUnauthenticatedError) {
        await this.onSessionExpired?.();
      }
      throw err;
    }
    return data as T;
  }

  /**
   * Like [request], but returns the status alongside the body.
   *
   * Several operations need it — upsert distinguishes create from update by a
   * 201, batch reports per-operation outcomes — and needing it was why they
   * hand-rolled their own fetch, each mapping errors slightly differently and
   * none of them clearing a rejected session. One path, two shapes of result.
   */
  private async requestWithStatus<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: await this.buildHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        // Not JSON: the status is more informative than an unparseable body,
        // and failing to parse must not mask it.
      }
    }
    if (!res.ok) {
      const err = koolbaseDataError(
        res.status,
        (data as Record<string, unknown>) ?? {},
        `Request failed: ${res.status}`
      );
      if (err instanceof KoolbaseUnauthenticatedError) {
        await this.onSessionExpired?.();
      }
      throw err;
    }
    return { status: res.status, data: data as T };
  }

  // ─── Query (cache-first) ───────────────────────────────────────────────────

  private async runQuery(
    collection: string,
    options: QueryOptions
  ): Promise<QueryResult> {
    const raw = await this.request<{ records: Record<string, unknown>[]; total: number }>(
      'POST',
      '/v1/sdk/db/query',
      {
        collection,
        filters: options.filters ?? {},
        limit: options.limit ?? 20,
        offset: options.offset ?? 0,
        order_by: options.orderBy,
        order_desc: options.orderDesc ?? false,
        populate: options.populate ?? [],
      }
    );
    const records = raw.records.map(recordFromWire);
    // Individually, as well as under the query key. The query cache answers
    // "what did this query return"; the record cache answers "what is the
    // latest copy of this record" — and an offline mutation composes against
    // the second. Without this, listing records and editing one, the most
    // ordinary flow there is, would have no baseline and be refused.
    //
    // Only the top-level records. Populated relations arrive embedded rather
    // than fetched in their own right, and caching them as if they were would
    // risk storing a shape that is not the whole record.
    const userId = this.getUserId() ?? 'anonymous';
    await Promise.all(
      records.map((r) =>
        r.collection
          ? cacheRecord(userId, r.collection, r.id, r.data, r.revision)
          : Promise.resolve()
      )
    );
    return { records, total: raw.total };
  }

  /**
   * Query records, cache-first (stale-while-revalidate).
   *
   * A cache hit is returned immediately with `isFromCache: true`, and a
   * background refresh updates the cache for the next call — so a repeat
   * query converges on the server's state one call behind it. Only a cache
   * miss awaits the network (`isFromCache: false`).
   *
   * Two consequences worth designing for: results can be one refresh stale,
   * even online — re-query if you need convergence after a known write; and
   * background refresh failures are swallowed by design (the cached result
   * has already been returned), so a dead network looks identical to a slow
   * refresh. Check `isFromCache` when the difference matters.
   *
   * The cache is per-user and persisted; it doubles as the offline baseline
   * store for `update`/`delete`.
   */
  async query(
    collection: string,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    const userId = this.getUserId() ?? 'anonymous';
    const queryHash = hashQuery(collection, options as Record<string, unknown>);

    const cached = await getCached(userId, collection, queryHash);

    if (cached) {
      this.runQuery(collection, options)
        .then(result => setCached(userId, collection, queryHash, result))
        .catch(() => {
          // Network unavailable — cached data already returned
        });
      return { ...cached, isFromCache: true };
    }

    const result = await this.runQuery(collection, options);
    await setCached(userId, collection, queryHash, result);
    return { ...result, isFromCache: false };
  }

  // ─── Insert (online-first with offline fallback) ───────────────────────────

  /**
   * Insert a new record into a collection.
   *
   * Online-first: awaits the server so a server-side rejection (unique
   * violation, validation error, permission denial) surfaces as the typed
   * `KoolbaseDataError` subclass — `insert` now throws `KoolbaseConflictError`
   * with the offending field on a 409, matching `upsert` and `update`.
   *
   * On genuine network failure (server unreachable, timeout) the write is
   * accepted optimistically: saved to the local cache and queued for sync
   * when connectivity returns.
   */
  async insert(
    collection: string,
    data: Record<string, unknown>
  ): Promise<KoolbaseRecord> {
    const userId = this.getUserId() ?? 'anonymous';

    try {
      // Online path: await the server and return the authoritative record
      // (with the server-assigned id). Refresh the collection cache so the
      // next query sees real data instead of a stale optimistic copy.
      const raw = await this.request<Record<string, unknown>>(
        'POST',
        '/v1/sdk/db/insert',
        { collection, data }
      );
      const record = recordFromWire(raw);
      await invalidateCache(userId, collection);
      // The response carries a fresh revision, so caching it keeps the
      // baseline current for whatever edits this record next.
      await cacheRecord(userId, collection, record.id, record.data, record.revision);
      return record;
    } catch (e) {
      // Server-reachable rejection: the server saw the request and refused.
      // Surface to the caller without writing optimistic state or queuing —
      // the server has already decided it will not accept this write, and
      // queuing it would just spin SyncEngine until max retries.
      // Anything the server answered with — a refusal, a conflict, a rejected
      // credential — must not be queued: it will be refused again on every
      // retry. Checked against the root rather than the data family, because a
      // rejected credential belongs to no single surface.
      if (e instanceof KoolbaseError) throw e;

      // The queue is per-user, and signed out there is no user: filing this
      // into the anonymous bucket would queue real work where no signed-in
      // sync ever looks — the fake-zero's origin. Refusing is honest; the
      // caller knows the change did not save and can say so.
      if (!this.getUserId()) {
        throw new KoolbaseUnauthenticatedError(
          'Signed out and offline — this change cannot be queued for sync.',
        );
      }

      // Genuine network failure → offline path: save to local cache and
      // queue for SyncEngine to retry when online. Return the optimistic
      // record so the UI has something to render in the meantime.
      const recordId = generateRecordId();
      const optimisticRecord: KoolbaseRecord = {
        id: recordId,
        createdBy: userId,
        data: { ...data, id: recordId },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await optimisticallyInsert(userId, collection, optimisticRecord);
      // No baseline: an insert has no prior state, and the record does not
      // exist on the server yet, so there is nothing to be conditional against.
      // An offline edit to it composes against this queued write instead.
      await queueWrite(userId, {
        id: generateWriteId(),
        operation: 'insert',
        collection,
        recordId: optimisticRecord.id,
        // The record's UUID travels inside the payload: the server honors a
        // caller-supplied id, which is what keeps offline identity alive across
        // the boundary — the whole reason record ids are UUIDs from birth.
        data: optimisticRecord.data,
      });
      return optimisticRecord;
    }
  }

  // ─── Upsert (online-only) ─────────────────────────────────────────────────

  /**
   * Insert a record, or update the existing one matching `match`.
   *
   * The server decides: exactly one match updates it, no match inserts a new
   * record (seeded with the `match` fields), more than one match is an error.
   * Returns the resulting record and a `created` flag (true = inserted, false
   * = updated).
   *
   * Online-only by design. Unlike `insert`, an upsert is NOT queued offline:
   * the insert-vs-update decision needs the server's authoritative view of
   * what already exists, so deferring it could create a duplicate or apply a
   * wrong update on later sync. It throws on network failure instead. A raw
   * fetch is used (not `request`) so the status code is readable: 201 =
   * created, 200 = updated.
   */
  async upsert(
    collection: string,
    match: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<UpsertResult> {
    const { status, data: body } = await this.requestWithStatus<Record<string, unknown>>(
      'POST',
      '/v1/sdk/db/upsert',
      { collection, match, data }
    );

    const created = status === 201;
    const record = recordFromWire(body as Record<string, unknown>);

    // Keep the cache fresh, same intent as insert's post-success invalidate.
    const userId = this.getUserId() ?? 'anonymous';
    await invalidateCache(userId, collection);
    await cacheRecord(userId, collection, record.id, record.data, record.revision);

    return { record, created };
  }

  // ─── Delete where (online-only) ─────────────────────────────────────────────

  /**
   * Bulk-delete every record in `collection` matching `filters`.
   *
   * The server applies the collection's delete rule (scoping to the caller for
   * owner/scoped rules) and returns the number of records deleted.
   *
   * Online-only by design — like upsert, this is NOT queued offline: a bulk
   * delete needs the server's authoritative view of what matches, so it throws
   * on network failure rather than risk deleting the wrong set on later sync.
   * The collection cache is invalidated on success.
   */
  async deleteWhere(
    collection: string,
    filters: Record<string, unknown>
  ): Promise<number> {
    const body = await this.request<Record<string, unknown>>(
      'POST',
      '/v1/sdk/db/delete-where',
      { collection, filters }
    );

    const userId = this.getUserId() ?? 'anonymous';
    await invalidateCache(userId, collection);

    return (body.deleted as number) ?? 0;
  }

  // ─── Batch (atomic, online-only) ────────────────────────────────────────────

  /**
   * Run multiple writes as a single atomic transaction.
   *
   * All `operations` commit together or none are applied — the server runs
   * them in one database transaction and rolls back entirely on any failure.
   * Operations apply in order and may span multiple collections.
   *
   * Online-only by design (like `upsert` and `deleteWhere`): atomicity needs
   * the server's authoritative view, so a batch is never queued offline — it
   * throws on network failure. A server-side rejection throws a
   * `KoolbaseDataException` whose message identifies which operation failed;
   * nothing was persisted.
   *
   * Returns one `BatchResult` per operation, in order.
   *
   * @example
   * const results = await Koolbase.db.batch([
   *   BatchOp.insert('orders', { total: 50 }),
   *   BatchOp.update(inventoryId, { stock: 9 }),
   *   BatchOp.upsert('counters', { match: { name: 'orders' }, data: { value: 1 } }),
   *   BatchOp.delete(cartItemId),
   * ]);
   */
  async batch(operations: BatchOp[]): Promise<BatchResult[]> {
    if (operations.length === 0) {
      throw new Error('batch requires at least one operation');
    }

    const body = await this.request<Record<string, unknown>>('POST', '/v1/sdk/db/batch', {
      operations: operations.map(batchOpToWire),
    });

    const results: BatchResult[] = (
      (body.results as Array<Record<string, unknown>>) ?? []
    ).map(r => ({
      type: (r.type as string) ?? '',
      record: r.record
        ? recordFromWire(r.record as Record<string, unknown>)
        : undefined,
      created: r.created as boolean | undefined,
      deleted: (r.deleted as boolean | undefined) ?? false,
    }));

    // Keep the cache consistent with what committed. Insert/upsert carry the
    // collection in the input op; update/delete address records by id, so we
    // don't know the collection at this layer — those refresh naturally on
    // the next query for the affected collection.
    const userId = this.getUserId() ?? 'anonymous';

    // Records returned by a batch carry their own collection on the wire, so
    // they can be cached even where the input op did not name one — which is
    // what the invalidation below cannot do. A batch commits transactionally, so
    // every record here landed together and carries a fresh revision.
    for (const r of results) {
      if (r.record?.collection) {
        await cacheRecord(
          userId,
          r.record.collection,
          r.record.id,
          r.record.data,
          r.record.revision
        );
      }
    }

    const touched = new Set<string>();
    for (const op of operations) {
      if (op.type === 'insert' || op.type === 'upsert') {
        touched.add(op.collection);
      }
    }
    for (const col of touched) {
      await invalidateCache(userId, col);
    }

    return results;
  }

  // ─── Get single record ──────────────────────────────────────────────────────

  // ─── Get single record ──────────────────────────────────────────────────────

 async get(recordId: string): Promise<KoolbaseRecord> {
    const raw = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/sdk/db/records/${recordId}`
    );
    const record = recordFromWire(raw);
    // Opening a record then editing it is the other ordinary flow, and a deep
    // link reaches it without a query ever having run.
    if (record.collection) {
      await cacheRecord(
        this.getUserId() ?? 'anonymous',
        record.collection,
        record.id,
        record.data,
        record.revision
      );
    }
    return record;
  }

  // ─── Conflicts ──────────────────────────────────────────────────────────────

  /**
   * Writes that could not be applied, waiting for a decision.
   *
   * Held rather than discarded, and surviving restarts. An app that never reads
   * these accumulates them invisibly, with the changes they hold never applied —
   * so if you support offline editing, surface them somewhere.
   */
  /**
   * Changes made offline, waiting to be sent. Oldest first.
   *
   * For sync indicators ("3 changes waiting") and for warning a user who is
   * about to log out with unsynced edits — see [PendingWrite] for why that
   * moment matters. Snapshot, not a live handle; per-user.
   */
  async pendingWrites(): Promise<PendingWrite[]> {
    const userId = this.requireUserId('the pending-write queue');
    const { pending } = await readOfflineState(userId);
    return pending.map(toPendingWrite);
  }

  async conflicts(): Promise<KoolbaseConflict[]> {
    const userId = this.requireUserId('the conflict list');
    const { conflicts } = await readOfflineState(userId);
    return conflicts.map(
      (c) =>
        new KoolbaseConflict(
          c.id,
          c.reason,
          c.operation,
          c.collection,
          c.recordId,
          c.local,
          c.baseline,
          c.server,
          c.baseRevision,
          c.serverRevision,
          c.createdAt,
          this.conflictResolver,
        ),
    );
  }

  /**
   * Resolves by id, reloading the stored conflict first.
   *
   * A conflict object handed to a UI can sit there while someone decides, and a
   * sync pass may resolve it or another write supersede it meanwhile. Acting on
   * values captured when the object was built would write against a state that
   * no longer exists.
   */
  private readonly conflictResolver: ConflictResolver = {
    resolveWithLocal: async (id) => {
      const c = await this.requireConflict(id);
      await this.applyResolution(c, c.local ?? {});
    },
    resolveWithMerge: async (id, data) => {
      const c = await this.requireConflict(id);
      await this.applyResolution(c, data);
    },
    resolveWithServer: async (id) => {
      const c = await this.requireConflict(id);
      // The server's version stands. Recorded as a decision by removing the
      // conflict, rather than the change quietly disappearing.
      await this.dropConflict(c.id);
    },
    abandon: async (id) => {
      const c = await this.requireConflict(id);
      await this.dropConflict(c.id);
    },
  };

  /**
   * Per-user state demands a user. Signed out, "no answer" must not be
   * disguised as "empty" — tonight's fake-zero: the display read the anonymous
   * bucket while a signed-in user's writes sat unseen in theirs.
   */
  private requireUserId(doing: string): string {
    const userId = this.getUserId();
    if (!userId) {
      throw new KoolbaseUnauthenticatedError(
        `Signed out — ${doing} is per-user state and has no answer without a user.`,
      );
    }
    return userId;
  }

  private async requireConflict(id: string): Promise<QueuedConflict> {
    const userId = this.requireUserId('conflict resolution');
    const { conflicts } = await readOfflineState(userId);
    const found = conflicts.find((c) => c.id === id);
    if (!found) {
      throw new KoolbaseDataError(
        'That conflict is no longer outstanding — it may already have been resolved.',
        'conflict_not_found',
      );
    }
    return found;
  }

  private async dropConflict(id: string): Promise<void> {
    const userId = this.requireUserId('conflict resolution');
    await mutateOfflineState(userId, (s) => {
      s.conflicts = s.conflicts.filter((c) => c.id !== id);
    });
  }

  /**
   * Issues the resolving write, conditional on the revision the refusal
   * reported, and clears the conflict only once the server accepts it.
   *
   * Clearing first would lose the change if the write then failed.
   */
  private async applyResolution(
    c: QueuedConflict,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const rev = c.serverRevision;
    if (c.operation === 'delete') {
      const q = rev !== undefined ? `?expected_revision=${rev}` : '';
      await this.request<null>('DELETE', `/v1/sdk/db/records/${c.recordId}${q}`);
    } else {
      await this.request<Record<string, unknown>>(
        'PATCH',
        `/v1/sdk/db/records/${c.recordId}`,
        { data: payload, ...(rev !== undefined ? { expected_revision: rev } : {}) },
      );
    }
    await this.dropConflict(c.id);
    await invalidateCache(this.getUserId() ?? 'anonymous', c.collection);
  }

  // ─── Update (online-first with offline fallback) ───────────────────────────

  /**
   * Update a record's fields by id.
   *
   * Online-first: awaits the server so a server-side rejection (unique
   * violation, not found, permission denial) surfaces as the typed
   * `KoolbaseDataError` subclass. An update that would violate a unique
   * constraint now throws `KoolbaseConflictError` with the offending field —
   * same shape as `insert` and `upsert`.
   *
   * On genuine network failure the update is queued for sync and a partial
   * optimistic record is returned so the UI can re-render the new fields
   * immediately.
   */
  /**
   * The record's state as the SDK last knew it, for composing an offline
   * mutation against.
   *
   * Two sources, in order. A record created offline is not in the cache as a
   * server record, but its queued insert holds the state a later edit builds on
   * — insert-then-correct is the ordinary offline sequence. Otherwise the cached
   * copy, with the revision it was read at.
   *
   * Null when neither exists: never seen on this device, or a queued delete has
   * already removed it locally.
   */
  private async resolveBaseline(
    userId: string,
    recordId: string
  ): Promise<{ baseline: Record<string, unknown>; revision?: number; collection: string } | null> {
    const state = await readOfflineState(userId);
    const queued = state.pending.filter((w: { recordId?: string }) => w.recordId === recordId);
    if (queued.length > 0) {
      let projected: Record<string, unknown> | null = null;
      for (const w of queued) {
        if (w.operation === 'insert') projected = { ...(w.data ?? {}) };
        else if (w.operation === 'update') projected = { ...(projected ?? {}), ...(w.data ?? {}) };
        else if (w.operation === 'delete') projected = null;
      }
      // A chain ending in a delete leaves nothing to build on: editing a record
      // already removed locally is a contradiction in the SDK's own state, not
      // a conflict to resolve against the server.
      if (projected === null) return null;
      return {
        baseline: projected,
        revision: queued[queued.length - 1].baseRevision,
        collection: queued[0].collection,
      };
    }
    const cached = await getCachedRecord(userId, recordId);
    if (!cached) return null;
    return { baseline: cached.data, revision: cached.revision, collection: cached.collection };
  }

  async update(
    recordId: string,
    data: Record<string, unknown>
  ): Promise<KoolbaseRecord> {
    const userId = this.getUserId() ?? 'anonymous';
    // Resolved before the request, so a network failure has somewhere to go.
    const base = await this.resolveBaseline(userId, recordId);

    try {
      const raw = await this.request<Record<string, unknown>>(
        'PATCH',
        `/v1/sdk/db/records/${recordId}`,
        { data }
      );
      const updated = recordFromWire(raw);
      if (updated.collection) {
        await cacheRecord(
          userId,
          updated.collection,
          updated.id,
          updated.data,
          updated.revision
        );
      }
      return updated;
    } catch (e) {
      // Server-reachable rejection: surface to caller without queuing — the
      // server already refused the write and will refuse it again on retry.
      // Anything the server answered with — a refusal, a conflict, a rejected
      // credential — must not be queued: it will be refused again on every
      // retry. Checked against the root rather than the data family, because a
      // rejected credential belongs to no single surface.
      if (e instanceof KoolbaseError) throw e;

      // Genuine network failure. Queueable only if the SDK knows what the
      // change was composed against — without that, replay would apply it
      // blindly and overwrite whatever happened while the device was away.
      if (!base) {
        throw new KoolbaseOfflineBaselineUnavailableError(
          'This record must be read at least once before it can be updated offline.'
        );
      }
      await queueWrite(userId, {
        id: generateWriteId(),
        operation: 'update',
        collection: base.collection,
        recordId,
        data,
        baseline: base.baseline,
        baseRevision: base.revision,
      });
      const merged = { ...base.baseline, ...data };
      await cacheRecord(userId, base.collection, recordId, merged, base.revision);
      // Optimistic: durable locally and queued to send, not yet accepted.
      return {
        id: recordId,
        collection: base.collection,
        data: merged,
        createdAt: '',
        updatedAt: new Date().toISOString(),
        revision: base.revision,
      };
    }
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  async delete(recordId: string): Promise<void> {
    const userId = this.getUserId() ?? 'anonymous';
    const base = await this.resolveBaseline(userId, recordId);
    try {
      await this.request<null>('DELETE', `/v1/sdk/db/records/${recordId}`);
      await removeCachedRecord(userId, recordId);
    } catch (e) {
      // A server that answered has refused: a permission denial or a missing
      // record will be refused again on every retry, so surface it rather than
      // queueing. An app told a delete succeeded when it did not has no way to
      // learn otherwise.
      // Anything the server answered with — a refusal, a conflict, a rejected
      // credential — must not be queued: it will be refused again on every
      // retry. Checked against the root rather than the data family, because a
      // rejected credential belongs to no single surface.
      if (e instanceof KoolbaseError) throw e;
      // Genuine network failure. Queued here rather than before the request,
      // which would leave a successful delete in the queue to replay later
      // against a record that may since have been recreated under the same id.
      // A delete replayed without knowing what the record was would remove
      // something the user last saw hours earlier and which may have changed
      // since — the more destructive kind of stale write.
      if (!base) {
        throw new KoolbaseOfflineBaselineUnavailableError(
          'This record must be read at least once before it can be deleted offline.'
        );
      }
      await queueWrite(userId, {
        id: generateWriteId(),
        operation: 'delete',
        collection: base.collection,
        recordId,
        baseline: base.baseline,
        baseRevision: base.revision,
      });
      // The queued write holds its own copy of the baseline, so removing the
      // cached record costs nothing and keeps local reads consistent with what
      // the user just did.
      await removeCachedRecord(userId, recordId);
    }
  }


  // ─── Vectors ────────────────────────────────────────────────────────────────

  /**
   * Write (or replace) a vector for a record on the named `field`.
   *
   * The field must already be declared on the collection via the dashboard
   * or CLI. `vector.length` must match the field's declared dimension;
   * otherwise throws `KoolbaseVectorDimensionMismatchError`.
   *
   * Online-only — vectors are not cached locally or queued offline because
   * HNSW similarity search has no useful offline semantics.
   *
   * @example
   * await Koolbase.db.setVector(
   *   articleId,
   *   'embedding',
   *   await myEmbeddingModel.encode(article.content),
   * );
   */
  async setVector(
    recordId: string,
    field: string,
    vector: number[],
  ): Promise<void> {
    await this.request<null>('POST', '/v1/sdk/db/set-vector', {
      record_id: recordId,
      field,
      vector,
    });
  }

  /**
   * Read a record's stored vector on the named `field`.
   *
   * Throws `KoolbaseNotFoundError` if either the field is not declared or
   * no vector has been set for this record on this field. Throws
   * `KoolbasePermissionError` if the caller cannot read this record per
   * the collection's read rule.
   *
   * Online-only.
   *
   * @example
   * const v = await Koolbase.db.getVector(articleId, 'embedding');
   * console.log(`${v.vector.length}-dim, updated ${v.updatedAt}`);
   */
  async getVector(recordId: string, field: string): Promise<KoolbaseVector> {
    const raw = await this.request<{
      record_id: string;
      field_name: string;
      vector: number[];
      created_at: string;
      updated_at: string;
    }>('POST', '/v1/sdk/db/get-vector', { record_id: recordId, field });
    return {
      recordId: raw.record_id,
      fieldName: raw.field_name,
      vector: raw.vector,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  /**
   * Remove a record's stored vector on the named `field`.
   *
   * Online-only. Throws `KoolbaseNotFoundError` if no vector is set for
   * `(recordId, field)`; throws `KoolbasePermissionError` if the caller
   * cannot write this record per the collection's write rule.
   *
   * Note: this removes the vector from the dimension table but does NOT
   * remove the field declaration itself — the field stays on the
   * collection and is still settable on other records.
   */
  async deleteVector(recordId: string, field: string): Promise<void> {
    await this.request<null>('POST', '/v1/sdk/db/delete-vector', {
      record_id: recordId,
      field,
    });
  }

  /**
   * Queue an embedding job for a record's vector field. The server's
   * embedding worker picks it up within ~1 second.
   *
   * If `text` is omitted, the vector field's configured `source_field`
   * value on the record is used.
   *
   * @example
   * await Koolbase.db.embedText({
   *   collection: 'articles',
   *   recordId: article.$id,
   *   vectorField: 'content_embedding',
   * });
   */
  async embedText(opts: {
    collection: string;
    recordId: string;
    vectorField: string;
    text?: string;
  }): Promise<void> {
    const body: Record<string, unknown> = {
      collection: opts.collection,
      record_id: opts.recordId,
      vector_field: opts.vectorField,
    };
    if (opts.text && opts.text.length > 0) {
      body.text = opts.text;
    }
    await this.request<{ queued: boolean }>('POST', '/v1/sdk/db/embed-text', body);
  }

  /**
   * Search for records based on their semantic similarity to a query.
   *
   * @example
   * // Server-side embedding — most common:
   * const result = await Koolbase.db.searchSemantic({
   *   collection: 'articles',
   *   field: 'content_embedding',
   *   queryText: 'how do I configure CI/CD?',
   *   limit: 10,
   * });
   *
   * // Client-side embedding:
   * const result = await Koolbase.db.searchSemantic({
   *   collection: 'articles',
   *   field: 'content_embedding',
   *   queryVector: precomputed,
   *   limit: 10,
   * });
   *
   * // Hybrid search (vector + BM25, RRF-fused):
   * const result = await Koolbase.db.searchSemantic({
   *   collection: 'articles',
   *   field: 'content_embedding',
   *   queryText: 'how do I configure CI/CD?',
   *   mode: 'hybrid',
   *   minSimilarity: 70,
   * });
   *
   * `mode` selects the retrieval strategy:
   * - `'semantic'` (default) — pure vector search via HNSW
   * - `'lexical'` — pure BM25 over the field's source text
   * - `'hybrid'` — vector + lexical, RRF-fused (k=60)
   *
   * `minSimilarity` (0..100, optional) filters out results below the
   * given similarity percentage server-side. Saves bandwidth on weak
   * matches. Only valid for semantic and hybrid; rejected by the
   * server on lexical mode.
   */
  async searchSemantic(opts: {
    collection: string;
    field: string;
    queryVector?: number[];
    queryText?: string;
    limit?: number;
    where?: Record<string, unknown>;
    mode?: SearchMode;
    minSimilarity?: number;
  }): Promise<SemanticSearchResult> {
    const hasVector = Array.isArray(opts.queryVector) && opts.queryVector.length > 0;
    const hasText = typeof opts.queryText === 'string' && opts.queryText.trim().length > 0;
    if (!hasVector && !hasText) {
      throw new Error('searchSemantic: provide either queryVector or queryText.');
    }
    if (hasVector && hasText) {
      throw new Error('searchSemantic: provide only one of queryVector or queryText.');
    }
    if (
      opts.minSimilarity !== undefined &&
      (opts.minSimilarity < 0 || opts.minSimilarity > 100)
    ) {
      throw new Error(
        `searchSemantic: minSimilarity must be between 0 and 100, got ${opts.minSimilarity}.`,
      );
    }
    const body: Record<string, unknown> = {
      collection: opts.collection,
      field: opts.field,
      limit: opts.limit ?? 20,
      // Always send mode so the server uses the SDK's intent rather
      // than its own default. Omitting for 'semantic' would also work
      // (server defaults to semantic) but explicit is safer if the
      // server's default ever shifts.
      mode: opts.mode ?? 'semantic',
    };
    if (hasVector) body.query_vector = opts.queryVector;
    if (hasText) body.query_text = opts.queryText;
    if (opts.where && Object.keys(opts.where).length > 0) {
      body.where = opts.where;
    }
    if (opts.minSimilarity !== undefined) {
      body.min_similarity = opts.minSimilarity;
    }
    const raw = await this.request<{
      results: Array<{ record: Record<string, unknown>; distance: number }>;
      total: number;
    }>('POST', '/v1/sdk/db/search-semantic', body);
    // A hit carries the complete public record, not a projection, so these are
    // safe to cache as baselines. A trimmed record would be worse than none: an
    // offline edit would compose against an incomplete picture and conflict
    // detection would compare against fields that were never there.
    const hits = (raw.results ?? []).map((r: any) => ({
      record: recordFromWire(r.record),
      distance: r.distance,
    }));
    const searchUserId = this.getUserId() ?? 'anonymous';
    await Promise.all(
      hits.map((h: any) =>
        h.record.collection
          ? cacheRecord(
              searchUserId,
              h.record.collection,
              h.record.id,
              h.record.data,
              h.record.revision
            )
          : Promise.resolve()
      )
    );

    return {
      hits: hits,
      total: raw.total ?? (raw.results ?? []).length,
    };
  }

  // ─── Manual sync ────────────────────────────────────────────────────────────

  async syncPendingWrites(): Promise<void> {
    await this.syncEngine.flush();
  }
}
