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

  constructor(
    config: KoolbaseConfig,
    getUserAccessToken?: () => Promise<string | null>,
  ) {
    this.config = config;
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
      throw new Error(
        (data as Record<string, unknown>)?.error as string ??
          'Function deploy failed'
      );
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
      throw new Error(
        (data as Record<string, unknown>)?.error as string ??
          'Function invocation failed'
      );
    }

    return {
      statusCode: res.status,
      data: data as Record<string, unknown>,
      success,
    };
  }
}
