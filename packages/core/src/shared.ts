// State that must be singular, even when this package is loaded twice.
//
// A dual-published package can end up in one application twice: the app's own
// code resolves the ESM build while a dependency resolves the CommonJS one.
// Module-level variables are then duplicated, and anything that assumes it is
// the only copy quietly stops being true.
//
// Two things here cannot tolerate that:
//
//   - the platform adapter, which a platform package installs once at
//     initialize. A second copy would keep the in-memory default, so sessions
//     would not persist and the offline queue would read empty.
//
//   - the offline-state lock table, which serialises read-modify-write on one
//     storage key per user. A second copy means two chains over the same key:
//     a queued write or a conflict can be lost. That is data, not a feature.
//
// Both live on a well-known globalThis key instead, so every copy of the
// module shares one instance. Keyed by a symbol registered in the global
// symbol registry, which is the same symbol across module instances and
// cannot collide with an application's own globals.

const SLOT = Symbol.for('koolbase.sdk.shared.v1');

interface Slot {
  platform?: unknown;
  locks?: Map<string, Promise<unknown>>;
}

function slot(): Slot {
  const g = globalThis as Record<PropertyKey, unknown>;
  if (!g[SLOT]) g[SLOT] = {} as Slot;
  return g[SLOT] as Slot;
}

/** Read a shared value, initialising it on first use. */
export function shared<K extends keyof Slot>(key: K, create: () => NonNullable<Slot[K]>): NonNullable<Slot[K]> {
  const s = slot();
  if (s[key] === undefined) s[key] = create();
  return s[key] as NonNullable<Slot[K]>;
}

/** Replace a shared value. */
export function setShared<K extends keyof Slot>(key: K, value: Slot[K]): void {
  slot()[key] = value;
}
