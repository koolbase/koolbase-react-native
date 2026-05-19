export interface KoolbaseConfig {
  publicKey: string;
  baseUrl: string;
  codePushChannel?: string;
  analyticsEnabled?: boolean;
  appVersion?: string;
  messagingEnabled?: boolean;
  /**
   * Optional custom storage adapter for persisting auth state. If omitted,
   * the SDK uses SecureAuthStorage backed by react-native-keychain (must
   * be installed). For Expo Go or custom secure backends, provide your
   * own KoolbaseAuthStorage implementation.
   */
  authStorage?: KoolbaseAuthStorage;
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface KoolbaseUser {
  id: string;
  email: string;
  phoneNumber?: string;
  phoneVerified?: boolean;
  fullName?: string;
  avatarUrl?: string;
  verified: boolean;
  createdAt: string;
}

export interface KoolbaseSession {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601 timestamp when accessToken expires; from server response. */
  expiresAt: string;
  user: KoolbaseUser;
}

/**
 * Abstract storage interface for persisting authentication state.
 *
 * The SDK ships with SecureAuthStorage (react-native-keychain) as the
 * default. Apps with custom requirements — Expo Go (where keychain is
 * unavailable), compliant encryption layers, or in-memory test mocks —
 * can implement this interface and inject it via KoolbaseConfig.authStorage.
 */
export interface KoolbaseAuthStorage {
  saveSession(session: KoolbaseSession): Promise<void>;
  readSession(): Promise<KoolbaseSession | null>;
  clear(): Promise<void>;
}

/**
 * Result of KoolbaseAuth.restoreSession(). Apps should branch on this:
 * - NoSession  → show login screen
 * - Restored   → show authenticated UI
 * - Expired    → show login screen with "session expired" message
 * - Offline    → show authenticated UI optimistically; API calls will
 *                fail until network is reachable
 */
export enum RestoreResult {
  NoSession = 'no_session',
  Restored = 'restored',
  Expired = 'expired',
  Offline = 'offline',
}

export interface RegisterParams {
  email: string;
  password: string;
  fullName?: string;
}

export interface LoginParams {
  email: string;
  password: string;
}

export interface SendOtpParams {
  phoneNumber: string;
}

export interface VerifyOtpParams {
  phoneNumber: string;
  code: string;
}

export interface LinkPhoneParams {
  phoneNumber: string;
  code: string;
}

export interface OtpSendResult {
  expiresAt: string;
}

export interface PhoneVerifyResult {
  session: KoolbaseSession;
  isNewUser: boolean;
}


// ─── Database ──────────────────────────────────────────────────────────────

export interface KoolbaseRecord {
  id: string;
  projectId: string;
  collectionId: string;
  createdBy?: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QueryOptions {
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDesc?: boolean;
  populate?: string[];
}

export interface QueryResult {
  records: KoolbaseRecord[];
  total: number;
  isFromCache?: boolean;
}

export interface PendingWrite {
  id: string;
  type: 'insert' | 'update' | 'delete';
  collection?: string;
  recordId?: string;
  data?: Record<string, unknown>;
  retries: number;
  createdAt: string;
}

// ─── Storage ───────────────────────────────────────────────────────────────

export interface UploadOptions {
  bucket: string;
  path: string;
  file: {
    uri: string;
    name: string;
    type: string;
  };
  onProgress?: (percent: number) => void;
}

// ─── Realtime ──────────────────────────────────────────────────────────────

export interface RealtimeEvent {
  type: 'created' | 'updated' | 'deleted';
  collection: string;
  record: KoolbaseRecord;
}

export type RealtimeCallback = (event: RealtimeEvent) => void;

// ─── Feature Flags / Config ────────────────────────────────────────────────

export interface BootstrapPayload {
  payload_version: string;
  flags: Record<string, {
    enabled: boolean;
    rollout_percentage: number;
    kill_switch: boolean;
  }>;
  config: Record<string, unknown>;
  version: {
    min_version: string;
    latest_version: string;
    force_update: boolean;
    update_message: string;
  };
}

export type VersionStatus = 'up_to_date' | 'soft_update' | 'force_update';

export interface VersionCheckResult {
  status: VersionStatus;
  message: string;
  latestVersion: string;
}

// ─── Functions ─────────────────────────────────────────────────────────────

export enum FunctionRuntime {
  Deno = 'deno',
  Dart = 'dart',
}

export interface DeployOptions {
  name: string;
  code: string;
  runtime?: FunctionRuntime;
  timeoutMs?: number;
}

export interface DeployResult {
  id: string;
  name: string;
  runtime: string;
  version: number;
  isActive: boolean;
  timeoutMs: number;
  lastDeployedAt: string | null;
}

export interface FunctionInvokeResult {
  statusCode: number;
  data: Record<string, unknown> | null;
  success: boolean;
}
