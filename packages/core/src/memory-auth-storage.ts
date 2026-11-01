import type { KoolbaseAuthStorage, KoolbaseSession } from './types.js';

/**
 * A session kept in memory only (R49): nothing survives the process. For
 * tests -- Koolbase.initializeForTesting uses it -- and for a host that must
 * not persist a session. The twin of the Flutter SDK's InMemoryAuthStorage.
 */
export class MemoryAuthStorage implements KoolbaseAuthStorage {
  private session: KoolbaseSession | null = null;

  async saveSession(session: KoolbaseSession): Promise<void> {
    this.session = session;
  }

  async readSession(): Promise<KoolbaseSession | null> {
    return this.session;
  }

  async clear(): Promise<void> {
    this.session = null;
  }
}
