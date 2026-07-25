import AsyncStorage from '@react-native-async-storage/async-storage';

// Single source of the anonymous device identifier for the whole SDK.
// Generated once, persisted, and shared by messaging (registration keying),
// feature flags (rollout bucketing: stableHash(deviceId + ":" + key) % 100),
// code push (targeting), and analytics. Previously each subsystem was handed a
// hardcoded 'rn-device' literal, so every RN device collided on one messaging
// registration row and bucketed identically for every rollout — a 10% flag was
// on for everyone or no one, never 10%.
//
// The id is anonymous, not a secret: what matters is uniform DISTRIBUTION so
// hash(id) % 100 is even, not unpredictability. We use crypto.getRandomValues
// when the runtime provides it (best distribution, no modulo bias) and fall
// back to Math.random otherwise — mirroring the runtime-guarded crypto use
// already in code-push.ts, and adding no dependency (per the SDK's stated
// preference against a crypto-grade UUID dependency for non-security ids).
const DEVICE_ID_KEY = 'koolbase:device_id';

let _cached: string | null = null;

export async function getOrCreateDeviceId(): Promise<string> {
  if (_cached) return _cached;
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      _cached = existing;
      return existing;
    }
    const newId = generateUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    _cached = newId;
    return newId;
  } catch {
    // Storage unavailable — return an ephemeral (unpersisted) id so the SDK
    // stays functional rather than throwing. Not stable across launches.
    return generateUUID();
  }
}

// UUID v4. Uses crypto.getRandomValues where available for uniform,
// modulo-bias-free bytes; Math.random fallback keeps it dependency-free.
function generateUUID(): string {
  const bytes = new Uint8Array(16);
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
