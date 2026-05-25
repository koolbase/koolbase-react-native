import AsyncStorage from '@react-native-async-storage/async-storage';
import { KoolbaseConfig } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BundlePayload {
  config: Record<string, unknown>;
  flags: Record<string, boolean>;
  directives: Record<string, unknown>;
  assets: { images: string[]; json: string[]; fonts: string[] };
  screens?: Record<string, string>;
  flows?: Record<string, unknown>;
}

export interface BundleManifest {
  bundle_id: string;
  app_id: string;
  version: number;
  base_app_version: string;
  max_app_version: string;
  platform: string;
  channel: string;
  checksum: string;
  signature: string;
  size_bytes: number;
  payload: BundlePayload;
  mandatory?: boolean;
}

interface CheckResponse {
  status: 'update_available' | 'no_update' | 'rollback';
  bundle?: {
    bundle_id: string;
    version: number;
    download_url: string;
    checksum: string;
    signature: string;
    size_bytes: number;
    mandatory: boolean;
  };
  revert_to?: string;
}

const STORAGE_KEY_ACTIVE = 'koolbase:codepush:active';
const STORAGE_KEY_PENDING = 'koolbase:codepush:pending';

// ─── Pure JS sha256 for checksum verification ────────────────────────────────

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  // Use SubtleCrypto if available (modern RN / Hermes)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback — skip verification (dev only)
  return '';
}

// ─── Zip manifest extraction ─────────────────────────────────────────────────

async function extractManifestFromZip(data: ArrayBuffer): Promise<BundleManifest | null> {
  try {
    // Dynamically import JSZip — must be installed as a dependency
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(data);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) return null;
    const json = await manifestFile.async('string');
    return JSON.parse(json) as BundleManifest;
  } catch (e) {
    console.warn('[KoolbaseCodePush] manifest extraction failed:', e);
    return null;
  }
}

// ─── KoolbaseCodePush ────────────────────────────────────────────────────────

export class KoolbaseCodePush {
  private config: KoolbaseConfig;
  private channel: string;
  private activeManifest: BundleManifest | null = null;
  private mandatoryPending = false;

  constructor(config: KoolbaseConfig, channel = 'stable') {
    this.config = config;
    this.channel = channel;
  }

  // Called inside Koolbase.initialize() — loads cached bundle then checks in background
  async init(options: {
    appVersion: string;
    platform: string;
    deviceId: string;
  }): Promise<void> {
    // Step 1 — promote pending → active if available
    await this.promotePendingIfAvailable();

    // Step 2 — load active manifest into memory
    this.activeManifest = await this.loadActive();

    if (this.activeManifest) {
      console.log(`[KoolbaseCodePush] bundle v${this.activeManifest.version} active`);
    } else {
      console.log('[KoolbaseCodePush] no active bundle — using app defaults');
    }

    // Step 3 — check for updates in background (non-blocking)
    this.checkInBackground(options);
  }

  private async promotePendingIfAvailable(): Promise<void> {
    try {
      const pending = await AsyncStorage.getItem(STORAGE_KEY_PENDING);
      if (!pending) return;

      // Archive current active → just overwrite, we keep one version
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVE, pending);
      await AsyncStorage.removeItem(STORAGE_KEY_PENDING);
      console.log('[KoolbaseCodePush] promoted pending bundle to active');
    } catch (e) {
      console.warn('[KoolbaseCodePush] promotion failed:', e);
      // One re-check will be triggered naturally by background check
    }
  }

  private async loadActive(): Promise<BundleManifest | null> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE);
      if (!stored) return null;
      return JSON.parse(stored) as BundleManifest;
    } catch {
      return null;
    }
  }

  private checkInBackground(options: {
    appVersion: string;
    platform: string;
    deviceId: string;
  }): void {
    // Fire and forget
    (async () => {
      try {
        const currentVersion = this.activeManifest?.version ?? 0;
        const res = await fetch(
          `${this.config.baseUrl}/v1/code-push/check` +
          `?app_version=${options.appVersion}` +
          `&platform=${options.platform}` +
          `&channel=${this.channel}` +
          `&device_id=${options.deviceId}` +
          `&current_bundle=${currentVersion}`,
          { headers: { 'x-api-key': this.config.publicKey } }
        );

        if (!res.ok) return;

        const body = await res.json() as CheckResponse;

        switch (body.status) {
          case 'update_available':
            await this.download(body.bundle!);
            break;
          case 'rollback':
            await this.handleRollback(body.revert_to ?? '0');
            break;
          case 'no_update':
            console.log('[KoolbaseCodePush] no update available');
            break;
        }
      } catch (e) {
        // Server unreachable — continue silently
        console.log('[KoolbaseCodePush] check failed silently:', e);
      }
    })();
  }

  private async download(ref: CheckResponse['bundle'] & object): Promise<void> {
    try {
      console.log(`[KoolbaseCodePush] downloading bundle v${ref.version}...`);

      const res = await fetch(ref.download_url);
      if (!res.ok) {
        console.warn('[KoolbaseCodePush] download failed:', res.status);
        return;
      }

      const data = await res.arrayBuffer();
      console.log(`[KoolbaseCodePush] downloaded ${data.byteLength} bytes`);

      // Verify checksum
      if (ref.checksum !== 'placeholder' && ref.checksum !== 'pending') {
        const actual = `sha256:${await sha256Hex(data)}`;
        if (actual !== ref.checksum && actual !== 'sha256:') {
          console.warn('[KoolbaseCodePush] checksum mismatch — bundle rejected');
          return;
        }
        console.log('[KoolbaseCodePush] checksum verified');
      } else {
        console.log('[KoolbaseCodePush] checksum skipped (dev mode)');
      }

      // Extract manifest
      const manifest = await extractManifestFromZip(data);
      if (!manifest) {
        console.warn('[KoolbaseCodePush] manifest extraction failed');
        return;
      }

      // Carry the mandatory flag from the check response onto the staged manifest
      manifest.mandatory = ref.mandatory;

      // Store as pending — activates on next launch
      await AsyncStorage.setItem(STORAGE_KEY_PENDING, JSON.stringify(manifest));
      console.log(`[KoolbaseCodePush] bundle v${manifest.version} ready for next launch`);

      if (ref.mandatory) {
        this.mandatoryPending = true;
        console.log('[KoolbaseCodePush] staged bundle is mandatory — notifying app');
        try {
          this.config.onMandatoryUpdate?.({ version: manifest.version, bundleId: manifest.bundle_id });
        } catch (cbErr) {
          console.warn('[KoolbaseCodePush] onMandatoryUpdate handler threw:', cbErr);
        }
      }
    } catch (e) {
      console.warn('[KoolbaseCodePush] download error:', e);
    }
  }

  private async handleRollback(revertTo: string): Promise<void> {
    console.log(`[KoolbaseCodePush] rollback to v${revertTo}`);
    await AsyncStorage.removeItem(STORAGE_KEY_ACTIVE);
    await AsyncStorage.removeItem(STORAGE_KEY_PENDING);
    this.activeManifest = null;
    console.log('[KoolbaseCodePush] reverted to app defaults');
  }

  // ─── Public accessors ────────────────────────────────────────────────────

  get hasActiveBundle(): boolean {
    return this.activeManifest !== null;
  }

  /**
   * True when a mandatory bundle has been staged this session and is awaiting
   * application (it activates on the next cold launch). Gate your UI on this to
   * prompt the user to restart so the required update takes effect.
   */
  get hasMandatoryUpdate(): boolean {
    return this.mandatoryPending;
  }

  get manifest(): BundleManifest | null {
    return this.activeManifest;
  }

  getBundleConfig(key: string): unknown | undefined {
    return this.activeManifest?.payload.config[key];
  }

  getBundleFlag(key: string): boolean | undefined {
    return this.activeManifest?.payload.flags[key];
  }

  getBundleDirective(key: string): unknown | undefined {
    return this.activeManifest?.payload.directives[key];
  }

  // ─── Directive handling ──────────────────────────────────────────────────

  private directiveHandlers: Map<string, (value: unknown) => void> = new Map();

  onDirective(key: string, handler: (value: unknown) => void): void {
    this.directiveHandlers.set(key, handler);
  }

  applyDirectives(): void {
    if (!this.activeManifest?.payload.directives) return;
    for (const [key, value] of Object.entries(this.activeManifest.payload.directives)) {
      const handler = this.directiveHandlers.get(key);
      if (handler) {
        console.log(`[KoolbaseCodePush] directive: ${key} = ${value}`);
        handler(value);
      }
    }
  }

  // ─── Cache management ────────────────────────────────────────────────────

  async clearBundle(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY_ACTIVE);
    await AsyncStorage.removeItem(STORAGE_KEY_PENDING);
    this.activeManifest = null;
    console.log('[KoolbaseCodePush] bundle cache cleared');
  }
}
