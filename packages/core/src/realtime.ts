import { cacheRecord, removeCachedRecord } from './cache-store.js';
import { KoolbaseConfig, RealtimeCallback, RealtimeEvent } from './types.js';
import { recordFromWire } from './record.js';
import { setLiveSource } from './live-source.js';

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
  // The open connection is a signed-out visitor's (the public key): its
  // messages leave project_id out.
  private anonymous = false;
  // Whose session the open connection was made for: the user id, or null
  // when signed out. sessionChanged compares against it.
  private connectedAs: string | null = null;
  // Bumped by sessionChanged: a connect still waiting for its token gives up
  // rather than open a connection for the old session.
  private generation = 0;
  // Pending close of an unused connection (scheduleIdleClose); null while
  // anyone is subscribed.
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** How long an unused connection stays open, in ms: a screen that comes
   *  straight back (navigating back, React's development double start)
   *  reuses it instead of opening another. */
  static idleGraceMs = 1000;

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
    // Live lists (CollectionQuery.live) subscribe through this client.
    setLiveSource(this);
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
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (!this.listeners.has(collection)) this.listeners.set(collection, []);
    this.listeners.get(collection)!.push(callback);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe(collection);
    } else {
      void this.connect();
    }

    return () => {
      const callbacks = this.listeners.get(collection);
      const i = callbacks ? callbacks.indexOf(callback) : -1;
      if (!callbacks || i === -1) return; // already unsubscribed: a second call does nothing
      callbacks.splice(i, 1);
      if (callbacks.length === 0) {
        this.listeners.delete(collection);
        this.sendUnsubscribe(collection);
        if (this.listeners.size === 0) this.scheduleIdleClose();
      }
    };
  }

  private async connect(): Promise<void> {
    if (this.connecting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    // Claimed BEFORE the token is awaited. Claimed after it, every subscribe
    // arriving meanwhile -- two live lists on one screen, React's development
    // double start -- found nobody connecting and opened its own socket; only
    // the last was remembered, and the others stayed open for good.
    this.connecting = true;
    const generation = this.generation;
    let token: string | null;
    try {
      token = await this.getToken();
    } catch {
      // A session that could not be refreshed is still a session: try again
      // later, never as a signed-out visitor.
      if (generation !== this.generation) return;
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    // The session changed while the token was on its way: sessionChanged
    // has started the connection for the new one.
    if (generation !== this.generation) return;
    if (this.listeners.size === 0) {
      // Everyone left while the token was on its way: nothing to connect for.
      this.connecting = false;
      return;
    }
    const userId = this.getUserId?.() ?? null;
    if (!token && userId) {
      // Signed in, but no usable token right now: try again later rather
      // than drop to public-only.
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    // Signed out: the project's public key, and only collections anyone can
    // read. The server pins the connection to the key's project.
    this.anonymous = !token;
    this.connectedAs = token ? userId : null;
    this.projectId = token ? projectIdFromToken(token) : null;
    const credential = token
      ? `token=${encodeURIComponent(token)}`
      : `public_key=${encodeURIComponent(this.config.publicKey)}`;

    const wsUrl = this.config.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${wsUrl}/v1/realtime/ws?${credential}`);
    } catch {
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
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
    this.send('subscribe', collection);
  }

  private sendUnsubscribe(collection: string): void {
    this.send('unsubscribe', collection);
  }

  /** A signed-out visitor's message leaves project_id out: it has none to
   *  give, and the server uses the public key's project. */
  private send(action: 'subscribe' | 'unsubscribe', collection: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.anonymous) {
      this.ws.send(JSON.stringify({ action, collection }));
    } else if (this.projectId) {
      this.ws.send(JSON.stringify({ action, project_id: this.projectId, collection }));
    }
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
    // Same reason as the analytics flush: a pending reconnect must not be
    // the thing that keeps a Node process alive.
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    (this.reconnectTimer as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * Closes the connection once nobody is subscribed -- after a moment, not at
   * once: a screen that unmounts and mounts again keeps the connection it had.
   * A subscribe within the moment cancels the close. Nothing reconnects after
   * it: reconnecting needs a subscriber.
   */
  private scheduleIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.listeners.size > 0) return;
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      const ws = this.ws;
      this.ws = null;
      this.connecting = false;
      if (ws) {
        // Detached first: this close is ours, not a dropped connection.
        ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
        ws.close();
      }
    }, KoolbaseRealtime.idleGraceMs);
    (this.idleTimer as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * The signed-in user changed: signed in, signed out, or another user. The
   * open connection was made for the previous session -- signed out it sees
   * only public collections, signed in it carries that user's access -- so it
   * is replaced by one for the new session, resubscribing every collection.
   * The same user again (a token refresh) changes nothing, and with nothing
   * open there is nothing to do: the next subscribe connects as whoever is
   * signed in then.
   */
  sessionChanged(): void {
    if (!this.ws && !this.connecting && !this.reconnectTimer) return;
    if (this.ws && !this.connecting && (this.getUserId?.() ?? null) === this.connectedAs) return;
    this.generation += 1;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    this.connecting = false;
    this.anonymous = false;
    this.projectId = null;
    this.reconnectAttempts = 0;
    if (ws) {
      // Detached first: this close is ours, not a dropped connection.
      ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
      ws.close();
    }
    if (this.listeners.size > 0) void this.connect();
  }

  disconnect(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.connecting = false;
    this.ws?.close();
    this.ws = null;
    this.projectId = null;
    this.listeners.clear();
  }
}
