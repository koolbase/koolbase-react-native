// A large file's upload, in parts (S3).
//
// Each part goes straight to storage on its own signed link, three at a time.
// A part that fails for a passing reason -- the network, storage busy -- is
// sent again, up to four times, waiting longer each time; one whose link
// has expired gets a new link. A failed upload is not abandoned: its id
// (`KoolbaseUploadTask.uploadId`) resumes it, sending only the parts that
// did not arrive. Cancelling abandons it.

import { KoolbaseStorageError, KoolbaseUploadCancelledError } from './storage-errors.js';
import { KoolbaseUploadTask, Transfer, transferBytes } from './storage-transfer.js';

/** The server's plan for an upload in parts, and which parts arrived. */
export interface MultipartPlan {
  upload_id: string;
  path: string;
  size: number;
  part_size: number;
  part_count: number;
  content_type: string;
  uploaded?: number[];
}

/** What sending the parts needs from the server. */
export interface MultipartApi {
  links(parts: number[]): Promise<Record<string, string>>;
  abort(): Promise<void>;
}

/** Parts in flight at once. */
export const PARTS_AT_ONCE = 3;
/** Tries per part. */
export const PART_TRIES = 4;
/** Links asked for at a time (the server signs at most 100 a call). */
const LINKS_AT_ONCE = 50;

/** How long to wait before try `n` (1-based) of a part; tests shorten it. */
export const partRetry = { delayMs: (n: number) => 500 * 2 ** (n - 1) };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A status a part may be sent again after. */
const passing = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * Sends the parts of `file` not yet in `plan.uploaded`, reporting the bytes
 * of the whole file; resolves once every part has arrived.
 */
export async function sendParts(task: KoolbaseUploadTask, plan: MultipartPlan, file: Blob, api: MultipartApi): Promise<void> {
  const count = plan.part_count;
  const partSize = plan.part_size;
  const bounds = (n: number): [number, number] => [(n - 1) * partSize, Math.min(n * partSize, plan.size)];
  const arrived = new Set(plan.uploaded ?? []);
  const sent = new Map<number, number>();
  for (const n of arrived) {
    const [a, b] = bounds(n);
    sent.set(n, b - a);
  }
  const report = () => {
    if (task.cancelled) return;
    let total = 0;
    for (const v of sent.values()) total += v;
    task.emit('uploading', Math.min(total, plan.size));
  };
  report();

  const todo: number[] = [];
  for (let n = 1; n <= count; n++) if (!arrived.has(n)) todo.push(n);

  // Links, asked for a few at a time -- one request for parts in flight at
  // once, not one each -- and renewed when one has expired.
  const links = new Map<number, string>();
  const asking = new Map<number, Promise<void>>();
  const ask = (parts: number[]): Promise<void> => {
    const p = api.links(parts).then((got) => {
      for (const [k, v] of Object.entries(got)) links.set(Number(k), v);
    });
    for (const n of parts) asking.set(n, p);
    return p.finally(() => {
      for (const n of parts) if (asking.get(n) === p) asking.delete(n);
    });
  };
  const linkFor = async (n: number, fresh = false): Promise<string> => {
    if (fresh) {
      links.delete(n);
      await ask([n]);
    } else if (!links.has(n)) {
      if (asking.has(n)) await asking.get(n);
      else {
        const from = Math.max(todo.indexOf(n), 0);
        await ask(todo.slice(from, from + LINKS_AT_ONCE).filter((p) => p === n || (!links.has(p) && !asking.has(p))));
      }
    }
    const url = links.get(n);
    if (!url) throw new KoolbaseStorageError(`No upload link for part ${n}`);
    return url;
  };

  // Every transfer in flight, so a cancel stops them all.
  const flying = new Set<Transfer>();
  task.setAbort(() => {
    for (const t of flying) t.abort();
  });

  const sendOne = async (n: number) => {
    const [a, b] = bounds(n);
    const body = file.slice(a, b);
    let fresh = false;
    for (let attempt = 1; ; attempt++) {
      task.checkCancelled();
      const url = await linkFor(n, fresh);
      fresh = false;
      task.checkCancelled();
      sent.set(n, 0);
      report();
      const t = transferBytes(url, body, null, (s) => {
        sent.set(n, s);
        report();
      });
      flying.add(t);
      let status = 0;
      let failure: unknown = null;
      try {
        status = (await t.done).status;
      } catch (e) {
        failure = e;
      } finally {
        flying.delete(t);
      }
      task.checkCancelled();
      if (failure === null && status >= 200 && status < 300) {
        sent.set(n, b - a);
        report();
        return;
      }
      if (failure instanceof KoolbaseUploadCancelledError) throw failure;
      sent.set(n, 0);
      report();
      const again = failure !== null || passing(status) || status === 403;
      if (!again || attempt >= PART_TRIES) {
        throw failure ?? new KoolbaseStorageError(`Upload of part ${n} failed: ${status}`);
      }
      // An expired link (403) is renewed; anything else waits and tries again.
      if (status === 403) fresh = true;
      else await sleep(partRetry.delayMs(attempt));
    }
  };

  try {
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const n = todo[next++];
        await sendOne(n);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARTS_AT_ONCE, todo.length) }, worker));
  } catch (e) {
    // One part failing stops the rest; the parts that arrived stay, for a
    // resume -- unless the upload was cancelled, which abandons it.
    for (const t of flying) t.abort();
    if (task.cancelled) {
      await api.abort().catch(() => undefined);
      throw new KoolbaseUploadCancelledError();
    }
    throw e;
  } finally {
    task.setAbort(null);
  }
}
