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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;

  constructor(config: KoolbaseConfig, getToken: TokenProvider) {
    this.config = config;
    this.getToken = getToken;
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
      } else if (payload.record) {
        msg = { type: mapped, collection: payload.collection, record: recordFromWire(payload.record) };
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

  private scheduleReconnect(): void {
    if (this.listeners.size === 0 || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 3000);
  }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.projectId = null;
    this.listeners.clear();
  }
}
