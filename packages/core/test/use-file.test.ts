/**
 * @jest-environment jsdom
 */
// useFile, rendered (storage S4): what the hook adds on top of
// KoolbaseFileController (tested in its own suite). It loads on mount,
// re-renders on every change, starts afresh for another file and never shows
// the previous file's answer.
import { act, createElement } from 'react';
type Root = { render(node: unknown): void; unmount(): void };
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): Root };
import { createUseFile, type UseFileResult } from '../src/react';
import { clearFilesRefreshers } from '../src/files-refresh';
import { KoolbaseStorageNotFoundError } from '../src/storage-errors';
import type { KoolbaseFileInfo } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => clearFilesRefreshers());

async function settle() {
  await act(async () => {
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(hook: (p: { b: string; p: string | null }) => UseFileResult, props: { b: string; p: string | null }) {
  let latest!: UseFileResult;
  function Probe(x: { args: { b: string; p: string | null } }) { latest = hook(x.args); return null; }
  const root: Root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe, { args: props })));
  return {
    current: () => latest,
    rerender: (next: { b: string; p: string | null }) => act(() => root.render(createElement(Probe, { args: next }))),
    unmount: () => act(() => root.unmount()),
  };
}

const info = (path: string): KoolbaseFileInfo => ({ path, name: path.split('/').pop() ?? path, size: 4 } as never);

describe('useFile', () => {
  it('is loading, then the file; another path starts afresh; not found is not found', async () => {
    const getFileInfo = jest.fn(async (_b: string, p: string) => {
      if (p === 'gone.png') throw new KoolbaseStorageNotFoundError();
      return info(p);
    });
    const useFile = createUseFile(() => ({ getFileInfo }));
    const h = mount((x) => useFile(x.b, x.p), { b: 'photos', p: 'a.png' });
    expect(h.current().status).toBe('loading');
    await settle();
    expect(h.current()).toMatchObject({ status: 'loaded', file: { path: 'a.png' } });
    expect(getFileInfo).toHaveBeenCalledWith('photos', 'a.png');
    h.rerender({ b: 'photos', p: 'b.png' });
    expect(h.current().file?.path ?? null).not.toBe('a.png');
    await settle();
    expect(h.current().file?.path).toBe('b.png');
    h.rerender({ b: 'photos', p: 'gone.png' });
    await settle();
    expect(h.current()).toMatchObject({ status: 'notFound', file: null });
    h.rerender({ b: 'photos', p: null });
    await settle();
    expect(h.current().status).toBe('notFound');
    expect(getFileInfo).toHaveBeenCalledTimes(3);
    h.unmount();
  });

  it('a re-render with the same file does not fetch again; refresh does', async () => {
    const getFileInfo = jest.fn(async (_b: string, p: string) => info(p));
    const useFile = createUseFile(() => ({ getFileInfo }));
    const h = mount((x) => useFile(x.b, x.p), { b: 'photos', p: 'a.png' });
    await settle();
    h.rerender({ b: 'photos', p: 'a.png' });
    await settle();
    expect(getFileInfo).toHaveBeenCalledTimes(1);
    await act(async () => { await h.current().refresh(); });
    expect(getFileInfo).toHaveBeenCalledTimes(2);
    h.unmount();
  });
});
