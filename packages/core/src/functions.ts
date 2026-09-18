import { functionInvokeError } from './function-errors';
import { KoolbaseUnauthenticatedError } from './errors';
import {
  KoolbaseConfig,
  FunctionInvokeResult,
  FunctionRuntime,
  DeployOptions,
  DeployResult,
} from './types';

export class KoolbaseFunctions {
  private config: KoolbaseConfig;
  private getUserAccessToken?: () => Promise<string | null>;

  /**
   * Called when the server rejects the caller's credentials.
   *
   * A session stops working for the whole SDK at once, so an app whose failing
   * call happens to be a Function invoke must not keep believing it is signed in.
   */
  private onSessionExpired?: () => Promise<void>;

  constructor(
    config: KoolbaseConfig,
    getUserAccessToken?: () => Promise<string | null>,
    onSessionExpired?: () => Promise<void>,
  ) {
    this.config = config;
    this.onSessionExpired = onSessionExpired;
    this.getUserAccessToken = getUserAccessToken;
  }

  // ─── Deploy ────────────────────────────────────────────────────────────────

  async deploy(options: DeployOptions): Promise<DeployResult> {
    const runtime = options.runtime ?? FunctionRuntime.Deno;

    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/functions/deploy`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.publicKey,
        },
        body: JSON.stringify({
          name: options.name,
          code: options.code,
          runtime,
          timeout_ms: options.timeoutMs ?? 10000,
        }),
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        ((data as Record<string, unknown>)?.error as string) ??
        'Function deploy failed';
      const err = functionInvokeError(res.status, message);
      if (err instanceof KoolbaseUnauthenticatedError) {
        await this.onSessionExpired?.();
      }
      throw err;
    }

    const d = data as Record<string, unknown>;
    return {
      id: d.id as string,
      name: d.name as string,
      runtime: d.runtime as string,
      version: d.version as number,
      isActive: d.is_active as boolean,
      timeoutMs: d.timeout_ms as number,
      lastDeployedAt: d.last_deployed_at as string | null,
    };
  }

  // ─── Invoke ────────────────────────────────────────────────────────────────

  async invoke(
    name: string,
    body?: Record<string, unknown>
  ): Promise<FunctionInvokeResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.publicKey,
    };

    const userToken = await this.getUserAccessToken?.();
    if (userToken) {
      headers['Authorization'] = `Bearer ${userToken}`;
    }

    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/functions/${name}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: body ?? {} }),
      }
    );

    const data = await res.json().catch(() => null);
    const success = res.status >= 200 && res.status < 300;

    if (!success) {
      const message =
        ((data as Record<string, unknown>)?.error as string) ??
        'Function invocation failed';
      const err = functionInvokeError(res.status, message);
      if (err instanceof KoolbaseUnauthenticatedError) {
        await this.onSessionExpired?.();
      }
      throw err;
    }

    return {
      statusCode: res.status,
      data: data as Record<string, unknown>,
      success,
    };
  }
}
