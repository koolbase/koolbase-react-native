import { KoolbaseConfig, UploadOptions } from './types';

export class KoolbaseStorage {
  private config: KoolbaseConfig;
  private getToken: () => Promise<string | null>;

  constructor(config: KoolbaseConfig, getToken: () => Promise<string | null>) {
    this.config = config;
    this.getToken = getToken;
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      'x-api-key': this.config.publicKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async upload(options: UploadOptions): Promise<{ url: string }> {
    // Get presigned upload URL
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/storage/${options.bucket}/upload`,
      {
        method: 'POST',
        headers: { ...(await this.buildHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: options.path,
          content_type: options.file.type,
        }),
      }
    );
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? 'Failed to get upload URL');
    }
    const { upload_url, public_url } = await res.json();

    // Upload to presigned URL
    const formData = new FormData();
    formData.append('file', {
      uri: options.file.uri,
      name: options.file.name,
      type: options.file.type,
    } as unknown as Blob);

    await fetch(upload_url, { method: 'PUT', body: formData });

    return { url: public_url };
  }

  async getDownloadUrl(bucket: string, path: string): Promise<string> {
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/storage/${bucket}/download?path=${encodeURIComponent(path)}`,
      { headers: await this.buildHeaders() }
    );
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? 'Failed to get download URL');
    }
    const { url } = await res.json();
    return url;
  }

  async delete(bucket: string, path: string): Promise<void> {
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/storage/${bucket}/delete`,
      {
        method: 'DELETE',
        headers: { ...(await this.buildHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }
    );
    if (!res.ok && res.status !== 204) {
      const data = await res.json();
      throw new Error(data.error ?? 'Delete failed');
    }
  }
}
