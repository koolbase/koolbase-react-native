// The realtime client a live list subscribes through. KoolbaseRealtime
// registers itself when it is created, as query-refresh.ts registers the
// refreshers writes run: a list reaches realtime without the host packages
// passing it in. None registered (realtime never created): a live list is
// simply a list.

export interface LiveSource {
  /** Calls back on every record event in the collection; returns the unsubscribe. */
  subscribe(collection: string, callback: (event: unknown) => void): () => void;
}

let active: LiveSource | null = null;

export function setLiveSource(source: LiveSource | null): void {
  active = source;
}

export function liveSource(): LiveSource | null {
  return active;
}
