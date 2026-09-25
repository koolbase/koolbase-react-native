/**
 * Network failures, made actionable.
 *
 * A browser rejects a request it may not make cross-origin with the same bare
 * TypeError ("Failed to fetch") as a dead network, and deliberately hides which
 * it was. The SDK cannot tell them apart either, so it names the likely causes,
 * starting with the one only the app's developer can fix: Trusted Origins.
 *
 * It stays a TypeError, so code that tells a network failure from a server
 * rejection that way (the offline queue) behaves exactly as before.
 */
export class KoolbaseNetworkError extends TypeError {
  code = 'network_error';
  /** A short message that is safe to show to people; `message` is for developers. */
  readonly userMessage = "We can't connect right now. Check your connection and try again.";
  readonly url: string;
  readonly origin?: string;

  constructor(url: string, cause: unknown) {
    const loc = (globalThis as { location?: { origin?: string } }).location;
    const origin = loc?.origin && loc.origin !== 'null' ? loc.origin : undefined;
    const reason = cause instanceof Error ? cause.message : String(cause);
    let host = url;
    try {
      host = new URL(url).origin;
    } catch {
      // keep the raw url
    }
    let message = `Could not reach Koolbase at ${host} (${reason}).`;
    message += origin
      ? ` If you are online, check that this site's address (${origin}) is in the project's Trusted Origins in the Koolbase dashboard.`
      : ' Check the network connection and the configured base URL.';
    super(message);
    this.name = 'KoolbaseNetworkError';
    this.url = url;
    this.origin = origin;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** fetch, with network failures turned into a KoolbaseNetworkError. */
export async function koolbaseFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    // A request the caller cancelled keeps its meaning.
    if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
    throw new KoolbaseNetworkError(input, e);
  }
}
