import NetInfo from '@react-native-community/netinfo';
import {
  getWriteQueue,
  removeFromWriteQueue,
  incrementWriteRetry,
} from './cache-store';
import { KoolbaseConfig } from './types';

type SyncCallback = () => void;

export class SyncEngine {
  private config: KoolbaseConfig;
  private getUserId: () => string | null;
  private getToken: () => Promise<string | null>;
  private onSyncComplete?: SyncCallback;
  private unsubscribe?: () => void;
  private isSyncing = false;

  constructor(
    config: KoolbaseConfig,
    getUserId: () => string | null,
    getToken: () => Promise<string | null>,
    onSyncComplete?: SyncCallback
  ) {
    this.config = config;
    this.getUserId = getUserId;
    this.getToken = getToken;
    this.onSyncComplete = onSyncComplete;
  }

  start(): void {
    this.unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) {
        this.flush();
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  async flush(): Promise<void> {
    if (this.isSyncing) return;
    const userId = this.getUserId();
    if (!userId) return;

    this.isSyncing = true;
    try {
      const queue = await getWriteQueue(userId);
      if (queue.length === 0) return;

      for (const write of queue) {
        try {
          await this.executeWrite(write);
          await removeFromWriteQueue(userId, write.id);
        } catch {
          await incrementWriteRetry(userId, write.id);
        }
      }

      this.onSyncComplete?.();
    } finally {
      this.isSyncing = false;
    }
  }

  private async executeWrite(write: {
    type: 'insert' | 'update' | 'delete';
    collection?: string;
    recordId?: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.publicKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    if (write.type === 'insert') {
      const res = await fetch(`${this.config.baseUrl}/v1/sdk/db/insert`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ collection: write.collection, data: write.data }),
      });
      if (!res.ok) throw new Error(`Insert failed: ${res.status}`);
    } else if (write.type === 'update') {
      const res = await fetch(
        `${this.config.baseUrl}/v1/sdk/db/records/${write.recordId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ data: write.data }),
        }
      );
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
    } else if (write.type === 'delete') {
      const res = await fetch(
        `${this.config.baseUrl}/v1/sdk/db/records/${write.recordId}`,
        { method: 'DELETE', headers }
      );
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed: ${res.status}`);
      }
    }
  }
}
