import {
  KoolbaseConfig,
  KoolbaseRecord,
  QueryOptions,
  QueryResult,
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

function generateId(): string {
  return 'local_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class KoolbaseDatabase {
  private config: KoolbaseConfig;
  private getUserId: () => string | null;
  private syncEngine: SyncEngine;

  constructor(config: KoolbaseConfig, getUserId: () => string | null) {
    this.config = config;
    this.getUserId = getUserId;
    this.syncEngine = new SyncEngine(config, getUserId);
    this.syncEngine.start();
  }

  private get headers(): Record<string, string> {
    const userId = this.getUserId();
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.publicKey,
      ...(userId ? { 'x-user-id': userId } : {}),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? `Request failed: ${res.status}`);
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
      { method: 'DELETE', headers: this.headers }
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
