import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: class {}, screen: {} }));

const { readNotesState, WINDOW_HEIGHT, WINDOW_WIDTH } = await import('./window');

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
