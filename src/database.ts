import {
  KoolbaseConfig,
  KoolbaseRecord,
  QueryOptions,
  QueryResult,
  UpsertResult,
  BatchOp,
  BatchResult,
} from './types';
import {
  getCached,
  setCached,
  invalidateCache,
  addToWriteQueue,
  optimisticallyInsert,
  hashQuery,
} from './cache-store';
import { SyncEngine } from './sync-engine';
import { recordFromWire } from './record';
import { koolbaseDataError } from './database-errors';

function generateId(): string {
  return 'local_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
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
  private syncEngine: SyncEngine;

  constructor(
    config: KoolbaseConfig,
    getUserId: () => string | null,
    getToken: () => Promise<string | null>,
  ) {
    this.config = config;
    this.getUserId = getUserId;
    this.getToken = getToken;
    this.syncEngine = new SyncEngine(config, getUserId, getToken);
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
    const data = await res.json();
    if (!res.ok) {
      throw koolbaseDataError(res.status, data, `Request failed: ${res.status}`);
    }
    return data as T;
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
    return { records: raw.records.map(recordFromWire), total: raw.total };
  }

  async query(
    collection: string,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    const userId = this.getUserId() ?? 'anonymous';
    const queryHash = hashQuery(collection, options as Record<string, unknown>);

    const cached = await getCached(userId, collection, queryHash);

    this.runQuery(collection, options)
      .then(result => setCached(userId, collection, queryHash, result))
      .catch(() => {
        // Network unavailable — cached data already returned
      });

    if (cached) {
      return { ...cached, isFromCache: true };
    }

    const result = await this.runQuery(collection, options);
    await setCached(userId, collection, queryHash, result);
    return { ...result, isFromCache: false };
  }

  // ─── Insert (optimistic) ────────────────────────────────────────────────────

  async insert(
    collection: string,
    data: Record<string, unknown>
  ): Promise<KoolbaseRecord> {
    const userId = this.getUserId() ?? 'anonymous';

    // Build optimistic record
    const optimisticRecord: KoolbaseRecord = {
      id: generateId(),
      createdBy: userId,
      data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Write to local cache immediately
    await optimisticallyInsert(userId, collection, optimisticRecord);

    // Add to write queue
    await addToWriteQueue(userId, {
      id: generateId(),
      type: 'insert',
      collection,
      data,
    });

    // Try network in background
    this.request<KoolbaseRecord>('POST', '/v1/sdk/db/insert', {
      collection,
      data,
    })
      .then(async serverRecord => {
        // Invalidate cache so next query gets real data
        await invalidateCache(userId, collection);
      })
      .catch(() => {
        // Will sync when online via SyncEngine
      });

    return optimisticRecord;
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
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/db/upsert`, {
      method: 'POST',
     headers: await this.buildHeaders(),
      body: JSON.stringify({ collection, match, data }),
    });

    const body = await res.json();
    if (!res.ok) {
      throw koolbaseDataError(res.status, body, `Upsert failed: ${res.status}`);
    }

    const created = res.status === 201;
    const record = recordFromWire(body as Record<string, unknown>);

    // Keep the cache fresh, same intent as insert's post-success invalidate.
    const userId = this.getUserId() ?? 'anonymous';
    await invalidateCache(userId, collection);

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
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/db/delete-where`, {
      method: 'POST',
      headers: await this.buildHeaders(),
      body: JSON.stringify({ collection, filters }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw koolbaseDataError(res.status, body, `Delete failed: ${res.status}`);
    }

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

    const res = await fetch(`${this.config.baseUrl}/v1/sdk/db/batch`, {
      method: 'POST',
      headers: await this.buildHeaders(),
      body: JSON.stringify({
        operations: operations.map(batchOpToWire),
      }),
    });

    const body = await res.json();
    if (!res.ok) {
      throw koolbaseDataError(res.status, body, `Batch failed: ${res.status}`);
    }

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
    return recordFromWire(raw);
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  async update(
    recordId: string,
    data: Record<string, unknown>
  ): Promise<KoolbaseRecord> {
    const userId = this.getUserId() ?? 'anonymous';

    await addToWriteQueue(userId, {
      id: generateId(),
      type: 'update',
      recordId,
      data,
    });

    try {
      const raw = await this.request<Record<string, unknown>>(
        'PATCH',
        `/v1/sdk/db/records/${recordId}`,
        { data }
      );
      return recordFromWire(raw);
    } catch {
      return {
        id: recordId,
        data,
        createdAt: '',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  async delete(recordId: string): Promise<void> {
    const userId = this.getUserId() ?? 'anonymous';

    // Add to write queue
    await addToWriteQueue(userId, {
      id: generateId(),
      type: 'delete',
      recordId,
    });

    // Try network
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/db/records/${recordId}`,
      { method: 'DELETE', headers: await this.buildHeaders(), }
    );
    if (!res.ok && res.status !== 204) {
      // Queued for sync — will retry when online
    }
  }

  // ─── Manual sync ────────────────────────────────────────────────────────────

  async syncPendingWrites(): Promise<void> {
    await this.syncEngine.flush();
  }
}
