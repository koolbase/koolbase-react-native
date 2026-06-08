export interface KoolbaseConfig {
  publicKey: string;
  baseUrl: string;
  codePushChannel?: string;
  onMandatoryUpdate?: (info: { version: number; bundleId: string }) => void;
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

  /**
   * Per-request timeout in milliseconds for auth endpoints. Default 10000.
   * On timeout, fetch rejects with an AbortError. restoreSession() treats
   * this as Offline (preserves optimistic state).
   */
  authTimeout?: number;

  /**
   * Injectable fetch implementation. Defaults to the global fetch. Useful
   * for testing (mock fetch), corporate proxies, or instrumented HTTP.
   */
  fetch?: FetchLike;
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

/**
 * Callback invoked when authentication state changes. Receives the
 * current user, or null when signed out. Listeners fire on login,
 * register, refresh, session restoration, logout, setSession, and
 * linkPhone. Errors thrown from a listener are swallowed so one
 * broken listener cannot break propagation to others.
 */
export type AuthStateListener = (user: KoolbaseUser | null) => void;

/**
 * Drop-in replacement for the global `fetch` function. Inject via
 * KoolbaseConfig.fetch for testing (mock fetch), proxying, or
 * monitoring. Matches the standard fetch signature.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

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
  collection?: string;
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

export interface UpsertResult {
  record: KoolbaseRecord;
  created: boolean;
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

// ─── Vectors ───────────────────────────────────────────────────────────────

/**
 * A stored vector retrieved by `KoolbaseDatabase.getVector()`. The `vector`
 * field carries the float values exactly as stored on the server; the
 * `recordId` + `fieldName` pair identifies which slot they came from.
 */
export interface KoolbaseVector {
  recordId: string;
  fieldName: string;
  vector: number[];
  /** ISO 8601 timestamp from the server. */
  createdAt: string;
  /** ISO 8601 timestamp from the server. */
  updatedAt: string;
}

/**
 * Retrieval strategy for `KoolbaseDatabase.searchSemantic()`.
 *
 * - `'semantic'` (default) — pure vector search via HNSW on cosine
 *   distance. Best for fuzzy / conceptual queries where exact term
 *   match isn't required.
 * - `'lexical'` — pure BM25 over the field's source text (Postgres
 *   `ts_rank_cd`). Best for exact terms, codes, names, acronyms.
 * - `'hybrid'` — vector + lexical fused with reciprocal rank fusion
 *   (k=60). Generally the strongest default for production search.
 */
export type SearchMode = 'semantic' | 'lexical' | 'hybrid';

/**
 * One ranked hit from `KoolbaseDatabase.searchSemantic()`. `record` is
 * the full record (same wire shape as a record returned by query/get).
 * `distance` is the cosine distance between the query vector and the
 * stored vector — lower means more similar. Range: 0 (identical
 * direction) to 2 (opposite direction).
 */
export interface KoolbaseSemanticHit {
  record: KoolbaseRecord;
  distance: number;
}

/**
 * Result of `KoolbaseDatabase.searchSemantic()`. `hits` is the ranked
 * list of nearest neighbors (best match first); `total` is the count of
 * hits returned (matches `hits.length` in v1 — preserved as a separate
 * field for future pagination).
 */
export interface SemanticSearchResult {
  hits: KoolbaseSemanticHit[];
  total: number;
}

// ─── Storage ───────────────────────────────────────────────────────────────

// ─── Storage ───────────────────────────────────────────────────────────────

export interface UploadOptions {
  bucket: string;
  path: string;
  file: {
    uri: string;
    name: string;
    type: string;
  };
  /**
   * If `false` (default in v5+), an upload to a path where an object
   * already exists is rejected with `KoolbaseStorageConflictError`. Pass
   * `true` to silently replace the existing object.
   */
  overwrite?: boolean;
  /**
   * User-defined key/value metadata to attach to the object at confirm
   * time. Optional — when omitted, the object stores empty metadata `{}`.
   *
   * Subject to server-side validation (≤50 keys, ≤8KB total, keys 1–64
   * chars matching `[a-z0-9_]+`, values ≤1024 chars, leading underscore
   * reserved); violations throw `KoolbaseStorageMetadataInvalidError`.
   *
   * On the `overwrite: true` path, metadata REPLACES any prior metadata
   * at this path (matches GCS semantics — a new upload at a path
   * produces a new object, not a patch of the old). Use `updateMetadata`
   * for post-upload merge changes.
   */
  metadata?: Record<string, string>;
  onProgress?: (percent: number) => void;
}

/**
 * A stored object's server-side metadata. Field names are camelCase here
 * even though the wire format is snake_case — the SDK maps for you.
 */
export interface KoolbaseObject {
  id: string;
  projectId: string;
  bucketId: string;
  /**
   * Name of the physical R2 bucket holding this object's bytes
   * (Gap #2). `'koolbase-storage-public'` means the object has a
   * stable CDN URL — construct it with
   * `KoolbaseStorage.publicUrlForObject(obj, bucket)`. Anything else
   * (typically `'koolbase-storage'`) means the object is in private
   * storage and reads go through {@link KoolbaseStorage.getDownloadUrl},
   * which returns a 1-hour presigned URL.
   */
  r2Bucket: string;
  userId: string | null;
  path: string;
  size: number;
  contentType: string | null;
  /**
   * User-defined key/value metadata attached to this object. Always
   * non-null — empty object when no metadata has been set (the server
   * returns `{}` rather than `null` so callers can treat it as a
   * guaranteed object without null checks). Set on upload via
   * `upload({ metadata })` or mutated post-upload via `updateMetadata`.
   */
  metadata: Record<string, string>;
  /** ISO 8601 timestamp from the server. */
  createdAt: string;
  /** ISO 8601 timestamp from the server. */
  updatedAt: string;
}

/**
 * One entry in an object's version timeline. Covers both the current
 * row (when {@link isCurrent} is true) and every history row, including
 * soft-delete markers (when {@link isDeleteMarker} is true — size 0, no
 * fetchable bytes). Returned from {@link KoolbaseStorage.listVersions}
 * and {@link KoolbaseStorage.getVersion}; the underlying bytes are
 * downloadable via {@link KoolbaseStorage.getDownloadUrl} with the
 * `versionId` argument.
 *
 * `versionId` may be null only on legacy rows uploaded before versioning
 * was enabled on the bucket — for those, {@link isCurrent} is true and
 * the row carries no history identity yet (gets backfilled on the next
 * overwrite).
 */
export interface KoolbaseObjectVersion {
  versionId: string | null;
  path: string;
  size: number;
  contentType: string | null;
  etag: string | null;
  metadata: Record<string, string>;
  r2Bucket: string;
  userId: string | null;
  /**
   * True for a tombstone row recording a soft-delete event. Size is 0
   * and there are no R2 bytes — treat as "the path was deleted at this
   * time" rather than fetchable content.
   */
  isDeleteMarker: boolean;
  /**
   * True for the row that currently lives in `storage_objects` (i.e.
   * what a no-versionId download returns). False for everything in
   * `storage_object_versions`.
   */
  isCurrent: boolean;
  /**
   * For the current row this is the time the current version became
   * current (overwrite or upload time). For history rows it's the time
   * the version was originally uploaded.
   */
  createdAt: string;
}

/**
 * Result of a successful `KoolbaseStorage.upload()` call.
 */
export interface UploadResult {
  object: KoolbaseObject;
  downloadUrl: string;
}

// ─── Realtime ──────────────────────────────────────────────────────────────

export interface RealtimeEvent {
  type: 'created' | 'updated' | 'deleted';
  collection: string;
  record?: KoolbaseRecord; // absent on delete
  recordId?: string;       // present on delete
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

/**
 * Apple's optional full-name structure returned only on a user's FIRST
 * Sign in with Apple. Both fields nullable; subsequent sign-ins omit
 * this entirely.
 *
 * Pass to `KoolbaseAuth.signInWithApple` only on first sign-in. The
 * server persists at link time and ignores on subsequent sign-ins
 * (matches Apple's documented contract).
 */
export interface AppleFullName {
  givenName?: string;
  familyName?: string;
}

/**
 * Parameters for `KoolbaseAuth.signInWithApple`. The SDK is
 * library-agnostic — `identityToken` should come from any native
 * Apple Sign-In package (e.g. `@invertase/react-native-apple-authentication`).
 */
export interface SignInWithAppleParams {
  identityToken: string;
  nonce?: string;
  fullName?: AppleFullName;
}

/**
 * Parameters for `KoolbaseAuth.signInWithGoogle`. The SDK is
 * library-agnostic — `idToken` should come from any native Google
 * Sign-In package (e.g. `@react-native-google-signin/google-signin`).
 *
 * Unlike Apple, Google embeds the user's name and email in the idToken
 * itself, so no separate `fullName` parameter is needed.
 */
export interface SignInWithGoogleParams {
  idToken: string;
  nonce?: string;
}

export type BatchOp =
  | { type: 'insert'; collection: string; data: Record<string, unknown> }
  | { type: 'update'; recordId: string; data: Record<string, unknown> }
  | { type: 'delete'; recordId: string }
  | {
      type: 'upsert';
      collection: string;
      match: Record<string, unknown>;
      data: Record<string, unknown>;
    };

/**
 * Factory helpers for constructing batch operations. Same shape as
 * Flutter's `KoolbaseBatchOp.insert(...)` etc., so the mental model
 * transfers between platforms.
 */
export const BatchOp = {
  insert: (
    collection: string,
    data: Record<string, unknown>,
  ): BatchOp => ({ type: 'insert', collection, data }),
  update: (
    recordId: string,
    data: Record<string, unknown>,
  ): BatchOp => ({ type: 'update', recordId, data }),
  delete: (recordId: string): BatchOp => ({ type: 'delete', recordId }),
  upsert: (
    collection: string,
    opts: { match: Record<string, unknown>; data: Record<string, unknown> },
  ): BatchOp => ({
    type: 'upsert',
    collection,
    match: opts.match,
    data: opts.data,
  }),
};

export interface BatchResult {
  type: string;
  record?: KoolbaseRecord;
  /** For upsert: true if a new record was inserted, false if one was updated. */
  created?: boolean;
  /** True for a successful delete. */
  deleted?: boolean;
}


// === Image Transformations ===============================================
// Served via Cloudflare's /cdn-cgi/image/ URL prefix. The koolbase.com zone
// gets 5,000 free unique transforms/month; beyond that, new transforms
// return 9422 at the edge until the next billing cycle.

export type KoolbaseImageFormat = 'auto' | 'webp' | 'avif' | 'jpeg' | 'png';

export type KoolbaseImageFit =
  | 'scale-down'
  | 'contain'
  | 'cover'
  | 'crop'
  | 'pad';

export type KoolbaseImageGravity =
  | 'auto'
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/**
 * Image-transformation options for `KoolbaseStorage.publicUrl` and
 * `KoolbaseStorage.publicUrlForObject`. Each field maps to one Cloudflare
 * Image Transformations parameter; unset fields are omitted.
 *
 * All numeric inputs are clamped silently to Cloudflare-supported ranges
 * (width/height 1-2000, quality 1-100, dpr 1-3) so a stray `width: 99999`
 * can't trigger error 9422 at the edge.
 *
 * @example
 * const url = KoolbaseStorage.publicUrl({
 *   projectId: pid, bucket: 'avatars', path: 'user.jpg',
 *   transform: { width: 400, height: 400, format: 'webp', quality: 80, fit: 'cover' },
 * });
 */
export interface KoolbaseImageTransform {
  /** Output width in pixels. Clamped to 1-2000. */
  width?: number;
  /** Output height in pixels. Clamped to 1-2000. */
  height?: number;
  /** Output format. `auto` negotiates based on the request's `Accept` header. */
  format?: KoolbaseImageFormat;
  /** Quality 1-100. Clamped. Has no effect on lossless formats (`png`). */
  quality?: number;
  /** Resize mode when both width and height are specified. */
  fit?: KoolbaseImageFit;
  /** Device pixel ratio multiplier. Clamped to 1-3. */
  dpr?: number;
  /** Crop anchor. Use with `fit: 'cover'` or `fit: 'crop'`. */
  gravity?: KoolbaseImageGravity;
}
