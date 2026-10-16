/**
 * @jest-environment jsdom
 */
// useFiles, rendered (storage S4): what the hook adds on top of
// KoolbaseFilesController (tested in its own suite). It loads on mount,
// re-renders on every change, starts afresh when the bucket or listing
// changes, never shows the previous listing's answer, and does not fetch
// again for a listing that is merely a new object.
import { act, createElement } from 'react';
type Root = { render(node: unknown): void; unmount(): void };
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): Root };
import { createUseFiles, type UseFilesResult } from '../src/react';
import { clearFilesRefreshers } from '../src/files-refresh';
import type { KoolbaseFilePage, ListFilesOptions } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => clearFilesRefreshers());

async function settle() {
  await act(async () => {
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount<P>(hook: (p: P) => UseFilesResult, props: P) {
  let latest!: UseFilesResult;
  function Probe(p: { args: P }) { latest = hook(p.args); return null; }
  const root: Root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe, { args: props })));
  return {
    current: () => latest,
    rerender: (next: P) => act(() => root.render(createElement(Probe, { args: next }))),
    unmount: () => act(() => root.unmount()),
  };
}

const page = (paths: string[], nextCursor: string | null = null): KoolbaseFilePage =>
  ({ files: paths.map((path) => ({ path, name: path })) as never, nextCursor, hasMore: nextCursor !== null });
const shown = (r: UseFilesResult) => r.files.map((f) => f.path);

describe('useFiles', () => {
  it('is loading, then loaded; loadMore appends the next page', async () => {
    const listFiles = jest.fn(async (o: ListFilesOptions) => (o.cursor ? page(['c.png']) : page(['a.png', 'b.png'], 'c1')));
    const useFiles = createUseFiles(() => ({ listFiles }));
    const h = mount((p: { b: string }) => useFiles(p.b, { prefix: 'trips/' }), { b: 'photos' });
    expect(h.current().status).toBe('loading');
    await settle();
    expect(h.current()).toMatchObject({ status: 'loaded', hasMore: true });
    expect(shown(h.current())).toEqual(['a.png', 'b.png']);
    expect(listFiles.mock.calls[0][0]).toEqual({ bucket: 'photos', prefix: 'trips/' });
    await act(async () => { await h.current().loadMore(); });
    await settle();
    expect(shown(h.current())).toEqual(['a.png', 'b.png', 'c.png']);
    expect(h.current().hasMore).toBe(false);
    h.unmount();
  });

  it('a listing that is only a new object does not fetch again; a new bucket starts afresh', async () => {
    let release: (p: KoolbaseFilePage) => void = () => {};
    const listFiles = jest.fn((o: ListFilesOptions) =>
      o.bucket === 'slow' ? new Promise<KoolbaseFilePage>((r) => { release = r; }) : Promise.resolve(page(['a.png'])));
    const useFiles = createUseFiles(() => ({ listFiles }));
    const h = mount((p: { b: string }) => useFiles(p.b, { sort: 'size' }), { b: 'slow' });
    h.rerender({ b: 'slow' });
    expect(listFiles).toHaveBeenCalledTimes(1);
    h.rerender({ b: 'photos' });
    await settle();
    expect(shown(h.current())).toEqual(['a.png']);
    release(page(['late.png']));
    await settle();
    expect(shown(h.current())).toEqual(['a.png']);
    h.unmount();
  });

  it('reports an error when the first load fails', async () => {
    const boom = new Error('down');
    const useFiles = createUseFiles(() => ({ listFiles: async () => { throw boom; } }));
    const h = mount((p: { b: string }) => useFiles(p.b), { b: 'photos' });
    await settle();
    expect(h.current().status).toBe('error');
    expect(h.current().error).toBe(boom);
    h.unmount();
  });
});
