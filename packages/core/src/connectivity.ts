import { getPlatform } from './platform.js';

/**
 * Whether the device reports a network connection. A hint, not a promise that
 * Koolbase is reachable: requests can still fail while online.
 *
 * 'unknown' until the platform first answers -- a real state, not a guess. An
 * app should neither show "offline" nor run online-only logic on it.
 */
export type ConnectivityState = 'unknown' | 'online' | 'offline';

/**
 * The device's connectivity, as state an app can render: getState() for now,
 * subscribe() for changes (the shape React's useSyncExternalStore takes).
 */
export class KoolbaseConnectivity {
  private state: ConnectivityState = 'unknown';
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  // A change event is fresher than the first read: once one arrives, a late
  // answer to that read is ignored.
  private heard = false;

  /** Starts following the platform. Called once by Koolbase.initialize. */
  start(): void {
    if (this.stop) return;
    const network = getPlatform().network;
    this.stop = network.onChange((online) => {
      this.heard = true;
      this.set(online ? 'online' : 'offline');
    });
    if (network.current) {
      network.current().then(
        (online) => {
          if (!this.heard && online !== null && online !== undefined) this.set(online ? 'online' : 'offline');
        },
        () => { /* the platform could not tell: stays unknown */ },
      );
    }
  }

  getState(): ConnectivityState {
    return this.state;
  }

  /** Called on every change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
    this.listeners.clear();
  }

  private set(next: ConnectivityState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* one broken listener must not stop the rest */ }
    }
  }
}
