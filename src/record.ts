import { KoolbaseRecord } from './types';

// Converts the flat public wire shape into a KoolbaseRecord.
// Server sends: { $id, $createdAt, $updatedAt, $collection, $createdBy?, ...fields }
export function recordFromWire(raw: Record<string, unknown>): KoolbaseRecord {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!key.startsWith('$')) data[key] = raw[key];
  }
  return {
    id: raw['$id'] as string,
    collection: raw['$collection'] as string | undefined,
    createdBy: raw['$createdBy'] as string | undefined,
    data,
    createdAt: raw['$createdAt'] as string,
    updatedAt: raw['$updatedAt'] as string,
  };
}
