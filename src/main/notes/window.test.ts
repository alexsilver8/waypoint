import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: class {}, screen: {} }));

const { popoverBounds, readNotesState, WINDOW_HEIGHT, WINDOW_WIDTH } = await import('./window');

describe('readNotesState', () => {
  it('opens at Raycast Notes’ size and floats, when nothing is saved', () => {
    const state = readNotesState(undefined);
    expect(state.bounds).toBeUndefined();
    expect(state.alwaysOnTop).toBe(true);
    expect([WINDOW_WIDTH, WINDOW_HEIGHT]).toEqual([475, 308]);
  });

  it('keeps an old window’s notes and place, but not its size or whether it floated', () => {
    const state = readNotesState({
      alwaysOnTop: false,
      sidebar: true,
      currentId: 'groceries',
      bounds: { x: 40, y: 60, width: 900, height: 700 },
    });
    expect(state.currentId).toBe('groceries');
    expect(state.bounds).toEqual({ x: 40, y: 60, width: 475, height: 308 });
    expect(state.alwaysOnTop).toBe(true);
    expect(state).not.toHaveProperty('sidebar');
  });

  it('keeps everything saved by this version', () => {
    const bounds = { x: 1, y: 2, width: 500, height: 400 };
    const state = readNotesState({ version: 2, alwaysOnTop: false, pinned: ['a'], bounds });
    expect(state).toMatchObject({ alwaysOnTop: false, pinned: ['a'], bounds });
  });
});

describe('popoverBounds', () => {
  const screen = { x: 0, y: 0, width: 1440, height: 900 };
  const window = { x: 400, y: 200, width: 475, height: 308 };

  it('centres a popover across the window, 100pt down it, hanging below a short note', () => {
    // 320 wide and as tall as the popover, in a clear margin of 20 for its shadow.
    expect(popoverBounds(window, screen, 240)).toEqual({ x: 458, y: 280, width: 360, height: 280 });
  });

  it('is never taller than Raycast’s tallest popover', () => {
    expect(popoverBounds(window, screen, 900).height).toBe(420 + 40);
  });

  it('moves up to stay on screen, and is never taller than it', () => {
    const low = { ...window, y: 700 };
    expect(popoverBounds(low, screen, 420)).toMatchObject({ y: 900 - 460, height: 460 });
    expect(popoverBounds(low, { ...screen, height: 300 }, 420)).toMatchObject({ y: 0, height: 300 });
  });

  it('stays on screen sideways', () => {
    expect(popoverBounds({ ...window, x: 1300 }, screen, 240).x).toBe(1440 - 360);
    expect(popoverBounds({ ...window, x: -300 }, screen, 240).x).toBe(0);
  });
});
