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
  addToWriteQueue,
  optimisticallyInsert,
  hashQuery,
} from './cache-store';
import { SyncEngine } from './sync-engine';
import { recordFromWire } from './record';
import { koolbaseDataError, KoolbaseDataError } from './database-errors';

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
      return record;
    } catch (e) {
      // Server-reachable rejection: the server saw the request and refused.
      // Surface to the caller without writing optimistic state or queuing —
      // the server has already decided it will not accept this write, and
      // queuing it would just spin SyncEngine until max retries.
      if (e instanceof KoolbaseDataError) throw e;

      // Genuine network failure → offline path: save to local cache and
      // queue for SyncEngine to retry when online. Return the optimistic
      // record so the UI has something to render in the meantime.
      const optimisticRecord: KoolbaseRecord = {
        id: generateId(),
        createdBy: userId,
        data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await optimisticallyInsert(userId, collection, optimisticRecord);
      await addToWriteQueue(userId, {
        id: generateId(),
        type: 'insert',
        collection,
        data,
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
  async update(
    recordId: string,
    data: Record<string, unknown>
  ): Promise<KoolbaseRecord> {
    const userId = this.getUserId() ?? 'anonymous';

    try {
      const raw = await this.request<Record<string, unknown>>(
        'PATCH',
        `/v1/sdk/db/records/${recordId}`,
        { data }
      );
      return recordFromWire(raw);
    } catch (e) {
      // Server-reachable rejection: surface to caller without queuing — the
      // server already refused the write and will refuse it again on retry.
      if (e instanceof KoolbaseDataError) throw e;

      // Genuine network failure → queue for sync and return an optimistic
      // partial record so the UI reflects the update immediately.
      await addToWriteQueue(userId, {
        id: generateId(),
        type: 'update',
        recordId,
        data,
      });
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
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/db/set-vector`, {
      method: 'POST',
      headers: await this.buildHeaders(),
      body: JSON.stringify({ record_id: recordId, field, vector }),
    });
    if (res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw koolbaseDataError(res.status, body, 'Set vector failed');
    }
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
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/db/delete-vector`, {
      method: 'POST',
      headers: await this.buildHeaders(),
      body: JSON.stringify({ record_id: recordId, field }),
    });
    if (res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw koolbaseDataError(res.status, body, 'Delete vector failed');
    }
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
    return {
      hits: (raw.results ?? []).map(r => ({
        record: recordFromWire(r.record),
        distance: r.distance,
      })),
      total: raw.total ?? (raw.results ?? []).length,
    };
  }

  // ─── Manual sync ────────────────────────────────────────────────────────────

  async syncPendingWrites(): Promise<void> {
    await this.syncEngine.flush();
  }
}
