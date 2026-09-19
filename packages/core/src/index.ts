// @koolbase/core — the SDK's shared behaviour, with no host assumptions.
//
// A platform package (react-native, js) supplies a PlatformAdapter and an auth
// storage, composes the clients, and re-exports this surface. Application
// code installs the platform package, never this one directly.

export * from './types.js';
export * from './errors.js';
export * from './conflict.js';
export * from './pending-write.js';
export * from './function-errors.js';
export * from './auth-errors.js';
export * from './database-errors.js';
export * from './storage-errors.js';

export { KoolbaseAuth } from './auth.js';
export { KoolbaseDatabase } from './database.js';
export { KoolbaseFlags } from './flags.js';
export { KoolbaseFunctions } from './functions.js';
export { KoolbaseRealtime } from './realtime.js';
export { KoolbaseStorage } from './storage.js';
export { KoolbaseAnalytics } from './analytics.js';
export { KoolbaseMessaging } from './messaging.js';
export type { RegisterTokenOptions } from './messaging.js';
export { getOrCreateDeviceId } from './device-id.js';
export { koolbaseSdkVersion } from './device-metadata.js';
export { RestoreResult } from './types.js';
export type { AuthStateListener, FetchLike, KoolbaseAuthStorage } from './types.js';

export {
  setPlatform,
  getPlatform,
  memoryPlatform,
  type PlatformAdapter,
  type PlatformStorage,
  type PlatformNetwork,
  type PlatformLifecycle,
  type PlatformInfo,
} from './platform.js';
