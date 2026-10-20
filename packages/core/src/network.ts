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

/** fetch, with network failures turned into a KoolbaseNetworkError. Not
 *  logged: sessionFetch's first attempt may yet be answered by renewal. */
async function sendOnce(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    // A request the caller cancelled keeps its meaning.
    if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
    throw new KoolbaseNetworkError(input, e);
  }
}

/** fetch, with network failures turned into a KoolbaseNetworkError, and a
 *  failed answer traced in a development build (#169). */
export async function koolbaseFetch(input: string, init?: RequestInit): Promise<Response> {
  return logFailure(input, init, await sendOnce(input, init));
}

// ─── Tracing a failed request (#169) ──────────────────────────────────

/** A development build: React Native's and Expo's __DEV__, else the
 *  bundler's NODE_ENV (written literally, so a bundler replaces it). An
 *  unbundled release with neither prints nothing. */
function devBuild(): boolean {
  const dev = (globalThis as { __DEV__?: unknown }).__DEV__;
  if (typeof dev === 'boolean') return dev;
  try {
    // @ts-ignore -- `process` is the bundler's, not a type this package declares
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/**
 * One line for a failure the caller receives:
 * `[Koolbase] POST /v1/sdk/auth/email/code -> 401 invalid_public_key: ...`.
 * The method, the path, the status and the server's reason; never the host,
 * the query, a header, the key, a token or the request body. The body is
 * read from a clone, so the caller still reads all of it.
 */
async function logFailure(input: string, init: RequestInit | undefined, res: Response): Promise<Response> {
  if (res.status < 400 || !devBuild()) return res;
  let path = input.split('?')[0];
  try {
    path = new URL(input).pathname;
  } catch {
    // a relative url: its path is what is left before the query
  }
  let reason = '';
  try {
    const j = JSON.parse(await res.clone().text()) as { code?: unknown; error?: unknown };
    reason = [j?.code, j?.error].filter((x): x is string => typeof x === 'string' && x !== '').join(': ');
  } catch {
    // not JSON: method, path and status are still worth the line
  }
  const method = (init?.method ?? 'GET').toUpperCase();
  console.warn(`[Koolbase] ${method} ${path} -> ${res.status}${reason ? ` ${reason}` : ''}`);
  return res;
}

// ─── Renewing a refused session (#96) ────────────────────────────────────

type Renewal = (refusedToken: string) => Promise<string | null>;
let renewal: Renewal | null = null;

/** Installed by Koolbase.initialize: renews the session a request was refused with. */
export function setSessionRenewal(fn: Renewal | null): void {
  renewal = fn;
}

function headerOf(headers: RequestInit['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  if (Array.isArray(headers)) return headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  const rec = headers as Record<string, string>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? rec[key] : undefined;
}

function withHeader(headers: RequestInit['headers'], name: string, value: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers && typeof (headers as Headers).forEach === 'function' && !Array.isArray(headers)) {
    (headers as Headers).forEach((v, k) => { out[k] = v; });
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
  } else if (headers) {
    Object.assign(out, headers as Record<string, string>);
  }
  for (const k of Object.keys(out)) if (k.toLowerCase() === name.toLowerCase()) delete out[k];
  out[name] = value;
  return out;
}

/**
 * koolbaseFetch for a data request. A request refused as unauthenticated
 * (401) while carrying the signed-in person's token is the session needing
 * renewal, not ending: the access token expired early, the clock is off, or
 * another tab renewed it. The session is renewed once and the request sent
 * again with the new token, so the caller never sees the first refusal.
 * Only when renewal is refused does the 401 reach the caller, and with it the
 * client's onSessionExpired, which ends the session.
 */
export async function sessionFetch(input: string, init?: RequestInit): Promise<Response> {
  // The first answer is traced only if the caller receives it (#169): a 401
  // renewal answers is not a failure anyone sees.
  const res = await sendOnce(input, init);
  if (res.status !== 401 || !renewal) return logFailure(input, init, res);
  const auth = headerOf(init?.headers, 'Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return logFailure(input, init, res);
  // Only a body that can be sent twice. Data requests send JSON text.
  if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') return logFailure(input, init, res);
  const fresh = await renewal(auth.slice('Bearer '.length));
  if (!fresh) return logFailure(input, init, res);
  return koolbaseFetch(input, { ...init, headers: withHeader(init?.headers, 'Authorization', `Bearer ${fresh}`) });
}
