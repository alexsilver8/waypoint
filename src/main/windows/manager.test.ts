import { describe, expect, it } from 'vitest';
import type { TargetWindow, WindowBackend } from './backend';
import type { Rect } from './layout';
import { WindowManager } from './manager';

const screen: Rect = { x: 0, y: 0, width: 1000, height: 800 };

/** A pretend system with windows that move when asked. */
function fakeBackend(windows: Record<string, Rect>, displays: Rect[] = [screen]) {
  let front: string | undefined = Object.keys(windows)[0];
  const moves: Array<[string, Rect]> = [];
  const backend: WindowBackend = {
    async front() {
      const bounds = front ? windows[front] : undefined;
      if (!front || !bounds) return undefined;
      return { window: { id: front, key: `key-${front}`, bounds: { ...bounds } }, displays };
    },
    async move(window: TargetWindow, bounds: Rect) {
      moves.push([window.id, bounds]);
      windows[window.id] = bounds;
    },
  };
  return {
    backend,
    moves,
    focus: (id: string | undefined) => {
      front = id;
    },
  };
}

describe('WindowManager', () => {
  it('moves the window in front to the layout', async () => {
    const { backend, moves } = fakeBackend({ editor: { x: 10, y: 10, width: 300, height: 200 } });
    await new WindowManager().apply(backend, 'right-half');
    expect(moves).toEqual([['editor', { x: 500, y: 0, width: 500, height: 800 }]]);
  });

  it('restores where the window was before it was first moved', async () => {
    const before = { x: 10, y: 10, width: 300, height: 200 };
    const windows = { editor: { ...before } };
    const { backend, moves } = fakeBackend(windows);
    const manager = new WindowManager();
    await manager.apply(backend, 'left-half');
    await manager.apply(backend, 'maximize');
    await manager.apply(backend, 'restore');
    expect(windows.editor).toEqual(before);
    expect(moves).toHaveLength(3);
    // Restored once, it's forgotten.
    await expect(manager.apply(backend, 'restore')).rejects.toThrow(/nothing to restore/);
  });

  it('restores after growing, shrinking and a sixth too', async () => {
    const before = { x: 300, y: 200, width: 400, height: 300 };
    const windows = { editor: { ...before } };
    const { backend, moves } = fakeBackend(windows);
    const manager = new WindowManager();
    await manager.apply(backend, 'make-larger');
    await manager.apply(backend, 'make-larger');
    expect(windows.editor).toEqual({ x: 200, y: 120, width: 600, height: 460 });
    await manager.apply(backend, 'make-smaller');
    expect(windows.editor).toEqual({ x: 250, y: 160, width: 500, height: 380 });
    await manager.apply(backend, 'bottom-right-sixth');
    expect(windows.editor).toEqual({ x: 667, y: 400, width: 333, height: 400 });
    await manager.apply(backend, 'restore');
    expect(windows.editor).toEqual(before);
    expect(moves).toHaveLength(5);
  });

  it('remembers each window separately', async () => {
    const windows = {
      editor: { x: 10, y: 10, width: 300, height: 200 },
      browser: { x: 50, y: 60, width: 400, height: 300 },
    };
    const { backend, focus } = fakeBackend(windows);
    const manager = new WindowManager();
    await manager.apply(backend, 'left-half');
    focus('browser');
    await manager.apply(backend, 'right-half');
    focus('editor');
    await manager.apply(backend, 'restore');
    expect(windows.editor).toEqual({ x: 10, y: 10, width: 300, height: 200 });
    expect(windows.browser).toEqual({ x: 500, y: 0, width: 500, height: 800 });
  });

  it("doesn't move a window that's already in place", async () => {
    const { backend, moves } = fakeBackend({ editor: { x: 0, y: 0, width: 500, height: 800 } });
    const manager = new WindowManager();
    await manager.apply(backend, 'left-half');
    expect(moves).toHaveLength(0);
    await expect(manager.apply(backend, 'restore')).rejects.toThrow(/nothing to restore/);
  });

  it('says why it can’t', async () => {
    const { backend, focus } = fakeBackend({ editor: { x: 0, y: 0, width: 300, height: 200 } });
    const manager = new WindowManager();
    await expect(manager.apply(backend, 'next-display')).rejects.toThrow('There is only one display.');
    focus(undefined);
    await expect(manager.apply(backend, 'maximize')).rejects.toThrow(/no window in front/);
  });
});
