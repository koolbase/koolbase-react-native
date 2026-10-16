// A bucket's files, as an app sees them (S1).
//
// The server applies the bucket's view rule to every file: a listing holds
// only files the signed-in person may view, and says nothing of the rest.

/** What a listing is ordered by. */
export type KoolbaseFileSort = 'path' | 'createdAt' | 'updatedAt' | 'size';

export interface ListFilesOptions {
  bucket: string;
  /** Only files whose path starts with this, taken literally. */
  prefix?: string;
  /** Files per page: 50 unless set, at most 100. */
  limit?: number;
  /** A page's `nextCursor`, for the page after it. */
  cursor?: string;
  /** By path unless set. */
  sort?: KoolbaseFileSort;
  /** Z to A, newest first, largest first. */
  descending?: boolean;
}

/** One file. */
export interface KoolbaseFileInfo {
  /** Its path in the bucket: what a record stores to point at it. */
  path: string;
  /** The last part of its path. */
  name: string;
  size: number;
  contentType: string | null;
  etag: string | null;
  metadata: Record<string, string>;
  versionId: string | null;
  /** Who uploaded it: a project user's id; null when the project did. */
  uploadedBy: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  /**
   * Its permanent link, while its bucket is public; null otherwise -- ask
   * for a download link instead.
   */
  publicUrl: string | null;
}

/** One page of a listing. */
export interface KoolbaseFilePage {
  files: KoolbaseFileInfo[];
  /**
   * Pass to the next call for the page after this one; null at the end. A
   * page can hold fewer files than asked for -- the server passes over
   * files you may not view -- and still have a next one.
   */
  nextCursor: string | null;
  hasMore: boolean;
}

const sortWire: Record<KoolbaseFileSort, string> = {
  path: 'path',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  size: 'size',
};

/** The query string for a listing. */
export function listFilesQuery(o: ListFilesOptions): string {
  const q = new URLSearchParams();
  q.set('bucket', o.bucket);
  if (o.prefix) q.set('prefix', o.prefix);
  if (o.limit != null) q.set('limit', String(o.limit));
  if (o.cursor) q.set('cursor', o.cursor);
  q.set('sort', sortWire[o.sort ?? 'path'] ?? 'path');
  q.set('order', o.descending ? 'desc' : 'asc');
  return q.toString();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function fileInfoFromJson(j: Record<string, unknown>): KoolbaseFileInfo {
  const path = String(j.path ?? '');
  const metadata: Record<string, string> = {};
  if (j.metadata && typeof j.metadata === 'object') {
    for (const [k, v] of Object.entries(j.metadata as Record<string, unknown>)) {
      metadata[k] = typeof v === 'string' ? v : String(v);
    }
  }
  return {
    path,
    name: path.split('/').pop() ?? path,
    size: Number(j.size ?? 0),
    contentType: str(j.content_type),
    etag: str(j.etag),
    metadata,
    versionId: str(j.version_id),
    uploadedBy: str(j.uploaded_by),
    createdAt: String(j.created_at ?? ''),
    updatedAt: String(j.updated_at ?? ''),
    publicUrl: str(j.public_url),
  };
}

export function filePageFromJson(j: Record<string, unknown>): KoolbaseFilePage {
  const files = Array.isArray(j.files) ? j.files : [];
  const nextCursor = str(j.next_cursor);
  return {
    files: files.map((f) => fileInfoFromJson(f as Record<string, unknown>)),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}
