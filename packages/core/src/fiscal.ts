import { koolbaseFetch } from './network.js';
import { KoolbaseConfig } from './types.js';
import { KoolbaseError, KoolbaseUnauthenticatedError } from './errors.js';

// ─── Models ──────────────────────────────────────────────────────────────────

/**
 * The lifecycle status of a fiscal intent.
 *
 * A sale is durably recorded the moment `submit` returns; fiscal numbers and
 * the authority's certification follow this state machine:
 *
 * - `queued` / `submitting` / `retrying` — sealed with allocated numbers;
 *   delivery to the authority is in progress.
 * - `fiscalized` — the authority answered; for certifying document kinds the
 *   `certification` is present.
 * - `blocked` — a precondition failed BEFORE any fiscal number was consumed
 *   (see `blockedReason`). Resubmitting the same `clientRef` after fixing the
 *   cause resumes it.
 * - `attention` — the authority rejected the document, or its credential died
 *   after sealing. An operator resolves it; the register's chain waits behind
 *   it.
 * - `voided` — terminally closed by an operator without fiscalization.
 *
 * `unknown` is the forward-compatible fallback: a status this SDK version has
 * not heard of parses as unknown rather than throwing, so a server that grows
 * a state does not break older clients.
 */
export type FiscalStatus =
  | 'created'
  | 'blocked'
  | 'queued'
  | 'submitting'
  | 'retrying'
  | 'fiscalized'
  | 'attention'
  | 'voided'
  | 'unknown';

const KNOWN_STATUSES: readonly string[] = [
  'created', 'blocked', 'queued', 'submitting',
  'retrying', 'fiscalized', 'attention', 'voided',
];

function parseStatus(raw: unknown): FiscalStatus {
  return typeof raw === 'string' && KNOWN_STATUSES.includes(raw)
    ? (raw as FiscalStatus)
    : 'unknown';
}

/**
 * The state of one fiscal intent.
 *
 * Jurisdiction-neutral by design: this SDK never learns a jurisdiction's
 * vocabulary. Payloads travel as objects shaped by the device's adapter, and
 * `certification` comes back as the authority granted it — for Ghana that
 * means `ysdcregsig`, `ysdcrecnum`, `qr_code` and so on, which the SDK
 * passes through without naming.
 */
export interface FiscalIntentResult {
  intentId: string;
  status: FiscalStatus;

  /** Why a `blocked` intent stopped, when the server said. */
  blockedReason?: string;

  /** Fiscal numbers allocated at sealing. */
  numbers?: Record<string, number>;

  /** When the intent was sealed and its numbers allocated. */
  sealedAt?: string;

  /**
   * What the authority granted, once `status` is `fiscalized`. This is the
   * receipt-rendering payload: for Ghana, the signature, receipt number and
   * QR verification URL.
   */
  certification?: Record<string, unknown>;
}

/** True once the authority has certified the document. */
export function isFiscalized(r: FiscalIntentResult): boolean {
  return r.status === 'fiscalized';
}

/** True while delivery to the authority is still in progress. */
export function isPending(r: FiscalIntentResult): boolean {
  return r.status === 'queued'
    || r.status === 'submitting'
    || r.status === 'retrying';
}

/** A fiscal request that failed. Carries the HTTP status where there was one. */
export class KoolbaseFiscalError extends KoolbaseError {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message, 'fiscal_failed');
    this.statusCode = statusCode;
    this.name = 'KoolbaseFiscalError';
    Object.setPrototypeOf(this, KoolbaseFiscalError.prototype);
  }
}

function resultFromJson(json: Record<string, unknown>): FiscalIntentResult {
  const numbers = json.numbers as Record<string, number> | undefined;
  return {
    intentId: String(json.intent_id ?? ''),
    status: parseStatus(json.status),
    blockedReason: json.blocked_reason as string | undefined,
    numbers: numbers ?? undefined,
    sealedAt: json.sealed_at as string | undefined,
    certification: json.certification as Record<string, unknown> | undefined,
  };
}

/**
 * Classify a response. Status and body in, result or error out.
 *
 * Exported for testability, and because auth handling belongs with the
 * session hook rather than here — the same split the Flutter SDK makes.
 */
export async function decodeFiscalResponse(
  status: number,
  body: string
): Promise<FiscalIntentResult> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new KoolbaseFiscalError(`fiscal: unreadable response (${status})`, status);
  }
  if ((status >= 200 && status < 300) || status === 202) {
    return resultFromJson(parsed);
  }
  throw new KoolbaseFiscalError(
    (parsed.error as string) ?? 'fiscal: request failed',
    status
  );
}

// ─── KoolbaseFiscal ──────────────────────────────────────────────────────────

/**
 * Koolbase Fiscal — submitting sales to a tax authority.
 *
 * Jurisdiction-neutral: the SDK moves payloads and reads back whatever the
 * authority certified. Ghana's GRA E-VAT is the first jurisdiction; nothing
 * here names it.
 */
export class KoolbaseFiscal {
  private config: KoolbaseConfig;
  private getToken: () => Promise<string | null>;
  private onSessionExpired?: () => Promise<void>;

  constructor(
    config: KoolbaseConfig,
    getToken: () => Promise<string | null>,
    onSessionExpired?: () => Promise<void>
  ) {
    this.config = config;
    this.getToken = getToken;
    this.onSessionExpired = onSessionExpired;
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.publicKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async decode(res: Response): Promise<FiscalIntentResult> {
    if (res.status === 401 || res.status === 403) {
      await this.onSessionExpired?.();
      throw new KoolbaseUnauthenticatedError(
        `fiscal: unauthenticated (${res.status})`
      );
    }
    return decodeFiscalResponse(res.status, await res.text());
  }

  /**
   * Submit a sale for fiscalization.
   *
   * The sale is durably recorded the moment this returns; fiscal numbers and
   * the authority's certification follow asynchronously — poll `status()`
   * with the same `clientRef` to watch it.
   *
   * **On timeout, do not resubmit blindly.** The sale may have fiscalized
   * anyway: the request reached the server and the response was lost. Poll
   * `status()` with the same `clientRef` instead, which is idempotent and
   * tells you what actually happened.
   *
   * @param clientRef your own reference for this sale; the idempotency key
   *   and the handle you poll and render receipts by.
   */
  async submit(params: {
    deviceId: string;
    clientRef: string;
    payload: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<FiscalIntentResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 30_000);
    try {
      const res = await koolbaseFetch(`${this.config.baseUrl}/v1/sdk/fiscal/submit`, {
        method: 'POST',
        headers: await this.buildHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          device_id: params.deviceId,
          client_ref: params.clientRef,
          payload: params.payload,
        }),
      });
      return await this.decode(res);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new KoolbaseFiscalError(
          'fiscal submit timed out — the sale may still fiscalize; '
            + 'poll status with the same clientRef'
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read an intent's current state by the reference it was submitted under.
   *
   * This is the receipt-rendering read: once the status is `fiscalized`, the
   * `certification` carries what the receipt must show — for Ghana, the
   * signature, receipt number and QR verification URL.
   */
  async status(params: {
    deviceId: string;
    clientRef: string;
    timeoutMs?: number;
  }): Promise<FiscalIntentResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 15_000);
    try {
      const q = new URLSearchParams({
        device_id: params.deviceId,
        client_ref: params.clientRef,
      });
      const res = await koolbaseFetch(
        `${this.config.baseUrl}/v1/sdk/fiscal/status?${q.toString()}`,
        { method: 'GET', headers: await this.buildHeaders(), signal: controller.signal }
      );
      return await this.decode(res);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new KoolbaseFiscalError('fiscal status timed out');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
