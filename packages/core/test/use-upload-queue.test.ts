/**
 * @jest-environment jsdom
 */
// useUploadQueue, rendered (storage S4): one queue for the component's
// life, its state re-rendered on every change.
import { act, createElement } from 'react';
type Root = { render(node: unknown): void; unmount(): void };
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): Root };
import { createUseUploadQueue, type UseUploadQueueResult } from '../src/react';
import type { KoolbaseUploadTask } from '../src/storage-transfer';
import type { UploadOptions } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useUploadQueue', () => {
  it('adds, shows each file, and keeps one queue across renders', async () => {
    const done: (() => void)[] = [];
    const startUpload = jest.fn((o: UploadOptions) => {
      let resolve!: () => void;
      const result = new Promise<unknown>((r) => { resolve = () => r({}); });
      done.push(() => resolve());
      return { onProgress: () => () => undefined, cancel: () => false, result, options: o } as unknown as KoolbaseUploadTask;
    });
    const useUploadQueue = createUseUploadQueue(() => ({ startUpload }));
    let latest!: UseUploadQueueResult;
    function Probe() { latest = useUploadQueue(); return null; }
    const root: Root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    const add = latest.add;
    act(() => { latest.add([{ bucket: 'photos', path: 'a.jpg', file: new Blob(['a']) }, { bucket: 'photos', path: 'b.jpg', file: new Blob(['b']), name: 'Bee' }]); });
    expect(latest.items.map((i) => [i.name, i.status])).toEqual([['a.jpg', 'uploading'], ['Bee', 'uploading']]);
    act(() => root.render(createElement(Probe)));
    expect(latest.add).toBe(add);
    await act(async () => { for (const d of done) d(); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(latest).toMatchObject({ running: false, done: 2 });
    act(() => root.unmount());
  });
});
