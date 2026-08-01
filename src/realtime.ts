import { cacheRecord, removeCachedRecord } from './cache-store';
import { KoolbaseConfig, RealtimeCallback, RealtimeEvent } from './types';
import { recordFromWire } from './record';

type TokenProvider = () => Promise<string | null>;

const EVENT_TYPE_MAP: Record<string, RealtimeEvent['type']> = {
  'db.record.created': 'created',
  'db.record.updated': 'updated',
  'db.record.deleted': 'deleted',
};

function projectIdFromToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const g: any = globalThis as any;
    let json: string;
    if (typeof g.atob === 'function') {
      const bin: string = g.atob(b64);
      json = decodeURIComponent(
        bin.split('').map((c: string) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
      );
    } else if (g.Buffer) {
      json = g.Buffer.from(b64, 'base64').toString('utf8');
    } else {
      return null;
    }
    return (JSON.parse(json).project_id as string) ?? null;
  } catch {
    return null;
  }
}

export class KoolbaseRealtime {
  private config: KoolbaseConfig;
  private getToken: TokenProvider;
  private ws: WebSocket | null = null;
  private projectId: string | null = null;
  private listeners: Map<string, RealtimeCallback[]> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;

  /**
   * Identifies whose cache a seen record belongs in.
   *
   * The record cache is keyed by user, so without this a watched record would
   * be filed under the wrong key — or under 'anonymous', which is worse than
   * not caching at all: a baseline stored where it will never be read.
   */
  private getUserId?: () => string | null;

  constructor(
    config: KoolbaseConfig,
    getToken: TokenProvider,
    getUserId?: () => string | null,
  ) {
    this.config = config;
    this.getToken = getToken;
    this.getUserId = getUserId;
  }

  /** Files a record seen over the socket, if we know whose it is. */
  private async cacheSeenRecord(
    collection: string,
    record: { id: string; data: Record<string, unknown>; revision?: number },
  ): Promise<void> {
    const userId = this.getUserId?.();
    if (!userId) return;
    await cacheRecord(userId, collection, record.id, record.data, record.revision);
  }

  private async forgetSeenRecord(recordId: string): Promise<void> {
    const userId = this.getUserId?.();
    if (!userId) return;
    await removeCachedRecord(userId, recordId);
  }

  subscribe(collection: string, callback: RealtimeCallback): () => void {
    if (!this.listeners.has(collection)) this.listeners.set(collection, []);
    this.listeners.get(collection)!.push(callback);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe(collection);
    } else {
      void this.connect();
    }

    return () => {
      const callbacks = this.listeners.get(collection) ?? [];
      const i = callbacks.indexOf(callback);
      if (i > -1) callbacks.splice(i, 1);
      if (callbacks.length === 0) {
        this.listeners.delete(collection);
        this.sendUnsubscribe(collection);
      }
    };
  }

  private async connect(): Promise<void> {
    if (this.connecting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    const token = await this.getToken();
    if (!token) {
      this.scheduleReconnect(); // sign-in may be in flight
      return;
    }
    this.projectId = projectIdFromToken(token);

    this.connecting = true;
    const wsUrl = this.config.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    const ws = new WebSocket(`${wsUrl}/v1/realtime/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.connecting = false;
      // A connection that opened is the only proof the endpoint and the
      // credentials are usable, so the backoff resets here rather than on a
      // close — a flaky link should not accumulate delay.
      this.reconnectAttempts = 0;
      for (const collection of this.listeners.keys()) this.sendSubscribe(collection); // (re)subscribe all
    };

    ws.onmessage = (event) => {
      let raw: any;
      try { raw = JSON.parse(event.data as string); } catch { return; }
      const mapped = EVENT_TYPE_MAP[raw?.type];
      if (!mapped) return; // ignore subscribed / unsubscribed / error / unknown
      const payload = raw.payload;
      if (!payload || !payload.collection) return;

      let msg: RealtimeEvent;
      if (mapped === 'deleted') {
        msg = { type: 'deleted', collection: payload.collection, recordId: payload.record_id };
        // Gone for everyone, so the cached copy is no longer a baseline for
        // anything. An edit composed against it would be refused at replay
        // regardless; removing it makes that a local refusal rather than a
        // round trip.
        void this.forgetSeenRecord(payload.record_id);
      } else if (payload.record) {
        const record = recordFromWire(payload.record);
        msg = { type: mapped, collection: payload.collection, record };
        // A record seen over the socket is as freshly seen as one fetched, and
        // a client watching a collection would otherwise hold a stale baseline
        // while looking at the change. Writes already queued are unaffected:
        // their baseline was copied in when they were made, so this cannot move
        // ground beneath them.
        void this.cacheSeenRecord(payload.collection, record);
      } else {
        return;
      }
      (this.listeners.get(payload.collection) ?? []).forEach((cb) => cb(msg));
    };

    ws.onclose = () => {
      this.connecting = false;
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    };

    ws.onerror = () => { /* onclose follows and handles reconnect */ };
  }

  private sendSubscribe(collection: string): void {
    if (!this.projectId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ action: 'subscribe', project_id: this.projectId, collection }));
  }

  private sendUnsubscribe(collection: string): void {
    if (!this.projectId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ action: 'unsubscribe', project_id: this.projectId, collection }));
  }

  /**
   * Reconnects with backoff, rather than every three seconds forever.
   *
   * A fixed interval is fine while a connection is merely interrupted and
   * costly when it is not: a device with no network, a wrong URL, or a session
   * the server will not accept retried indefinitely, draining battery and data
   * the user cannot see or stop.
   *
   * Doubling from three seconds to a minute keeps a brief interruption
   * recovering quickly while a lasting one settles into an interval that costs
   * almost nothing. The counter resets when a connection opens, so a flaky link
   * does not accumulate delay.
   */
  private scheduleReconnect(): void {
    if (this.listeners.size === 0 || this.reconnectTimer) return;
    const delay = Math.min(3000 * Math.pow(2, this.reconnectAttempts), 60000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.projectId = null;
    this.listeners.clear();
  }
}
