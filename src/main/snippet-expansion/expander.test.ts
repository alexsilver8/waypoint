import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snippet } from '../../shared/snippets';
import type { ExpanderOptions, KeyboardHook } from './expander';
import type { KeyPress } from './typed-keys';

vi.mock('electron', () => ({ Notification: { isSupported: () => false }, systemPreferences: {} }));

const { SnippetExpander } = await import('./expander');

const LETTERS: Record<string, number> = { s: 31, i: 23, g: 34, h: 35, e: 18, y: 21 };
const BACKSPACE = 14;
const V = 47;
const CTRL = 29;
const META = 3675;

/** A hook that records the keys pressed, and sends them back as the real one does. */
function fakeHook() {
  const listeners: { key?: (key: KeyPress) => void; mouse?: () => void } = {};
  const taps: Array<[number, number[]]> = [];
  const press = (keycode: number, modifiers: Partial<KeyPress> = {}) =>
    listeners.key?.({ keycode, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...modifiers });
  const hook: KeyboardHook & { started: boolean } = {
    started: false,
    onKeyDown: (listener) => {
      listeners.key = listener;
    },
    onMouseDown: (listener) => {
      listeners.mouse = listener;
    },
    start() {
      hook.started = true;
    },
    stop() {
      hook.started = false;
    },
    tap(keycode, modifiers = []) {
      taps.push([keycode, modifiers]);
      press(keycode);
    },
  };
  /** Types `text`: `!` with Shift, the letters above, and spaces. */
  const type = (text: string) => {
    for (const character of text) {
      if (character === '!') press(2, { shiftKey: true });
      else if (character === ' ') press(57);
      else press(LETTERS[character] ?? 0);
    }
  };
  return { hook, taps, type, click: () => listeners.mouse?.() };
}

function setup(overrides: Partial<ExpanderOptions<string>> = {}) {
  const fake = fakeHook();
  const clipboard = { text: 'what you copied', writes: [] as string[] };
  const snippets: Snippet[] = [{ id: 'sig', name: 'Signature', text: 'Thanks,\nAlex', keyword: '!sig' }];
  const options: ExpanderOptions<string> = {
    platform: 'win32',
    loadHook: async () => fake.hook,
    snippets: () => snippets,
    waypointFocused: () => false,
    trusted: () => true,
    readClipboard: async () => clipboard.text,
    clipboard: {
      save: async () => clipboard.text,
      async write(text) {
        clipboard.writes.push(text);
        clipboard.text = text;
      },
      async restore(saved) {
        clipboard.text = saved;
      },
    },
    wait: async () => {},
    ...overrides,
  };
  return { ...fake, clipboard, snippets, expander: new SnippetExpander(options) };
}

/** Lets an expansion that started on a key finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('SnippetExpander', () => {
  it('erases a keyword typed in another app, pastes the snippet, and puts the clipboard back', async () => {
    const { expander, type, taps, clipboard } = setup();
    await expander.setEnabled(true);
    expect(expander.status).toBe('on');
    type('hey !sig');
    await settle();
    expect(taps).toEqual([
      [BACKSPACE, []],
      [BACKSPACE, []],
      [BACKSPACE, []],
      [BACKSPACE, []],
      [V, [CTRL]],
    ]);
    expect(clipboard.writes).toEqual(['Thanks,\nAlex']);
    expect(clipboard.text).toBe('what you copied');
  });

  it('pastes with ⌘V on macOS, and fills in placeholders', async () => {
    const { expander, type, taps, clipboard, snippets } = setup({ platform: 'darwin' });
    snippets[0] = { ...snippets[0], text: 'You said: {clipboard}' } as Snippet;
    await expander.setEnabled(true);
    type('!sig');
    await settle();
    expect(taps.at(-1)).toEqual([V, [META]]);
    expect(clipboard.writes).toEqual(['You said: what you copied']);
  });

  it('leaves the keys it presses itself, and keywords typed in Waypoint, alone', async () => {
    let focused = true;
    const { expander, type, taps } = setup({ waypointFocused: () => focused });
    await expander.setEnabled(true);
    type('!sig');
    await settle();
    expect(taps).toEqual([]);
    focused = false;
    type('!sig');
    await settle();
    // The Backspaces it pressed came back through the hook, and didn't erase anything else.
    expect(taps).toHaveLength(5);
  });

  it('starts over after a click', async () => {
    const { expander, type, click, taps } = setup();
    await expander.setEnabled(true);
    type('!s');
    click();
    type('ig');
    await settle();
    expect(taps).toEqual([]);
  });

  it('stops watching the keyboard when turned off', async () => {
    const { expander, hook } = setup();
    await expander.setEnabled(true);
    expect(hook.started).toBe(true);
    await expander.setEnabled(false);
    expect(hook.started).toBe(false);
    expect(expander.status).toBe('off');
  });

  it('waits for Accessibility on macOS, then starts', async () => {
    vi.useFakeTimers();
    let trusted = false;
    const loadHook = vi.fn(async () => fakeHook().hook);
    const { expander } = setup({ platform: 'darwin', trusted: () => trusted, loadHook });
    await expander.setEnabled(true);
    expect(expander.status).toBe('needs-accessibility');
    expect(loadHook).not.toHaveBeenCalled();
    trusted = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(expander.status).toBe('on');
  });

  it("says when it can't work: on Wayland, or without the hook", async () => {
    const wayland = setup({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } });
    await wayland.expander.setEnabled(true);
    expect(wayland.expander.status).toBe('unsupported');

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = setup({
      loadHook: async () => {
        throw new Error('libXtst.so.6: cannot open shared object file');
      },
    });
    await missing.expander.setEnabled(true);
    expect(missing.expander.status).toBe('unavailable');
  });
});
