// @koolbase/core — the SDK's shared behaviour, with no host assumptions.
//
// A platform package (react-native, js) supplies a PlatformAdapter and an auth
// storage, composes the clients, and re-exports this surface. Application
// code installs the platform package, never this one directly.

export * from './types';
export * from './errors';
export * from './conflict';
export * from './pending-write';
export * from './function-errors';
export * from './auth-errors';
export * from './database-errors';
export * from './storage-errors';

export { KoolbaseAuth } from './auth';
export { KoolbaseDatabase } from './database';
export { KoolbaseFlags } from './flags';
export { KoolbaseFunctions } from './functions';
export { KoolbaseRealtime } from './realtime';
export { KoolbaseStorage } from './storage';
export { KoolbaseAnalytics } from './analytics';
export { KoolbaseMessaging } from './messaging';
export type { RegisterTokenOptions } from './messaging';
export { getOrCreateDeviceId } from './device-id';
export { koolbaseSdkVersion } from './device-metadata';
export { RestoreResult } from './types';
export type { AuthStateListener, FetchLike, KoolbaseAuthStorage } from './types';

export {
  setPlatform,
  getPlatform,
  memoryPlatform,
  type PlatformAdapter,
  type PlatformStorage,
  type PlatformNetwork,
  type PlatformLifecycle,
  type PlatformInfo,
} from './platform';
